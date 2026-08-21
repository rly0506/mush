/**
 * GOAL-051: 液态临时战时攻关小队与指挥犬选举协议 (Liquid Squad Engine)
 */

import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { SymbolicMemoryGraph } from './symbolic-memory.ts';

export type SquadStatus = 'FORMED' | 'ACTIVE' | 'DISBANDED';

export interface DogCapabilityProfile {
  architecture: number;
  coding: number;
  debugging: number;
  testing: number;
  security: number;
}

export const DEFAULT_DOG_CAPABILITIES: Record<string, DogCapabilityProfile> = {
  agy: { architecture: 0.95, coding: 0.95, debugging: 0.9, testing: 0.85, security: 0.85 },
  'claude-code': { architecture: 0.9, coding: 0.95, debugging: 0.85, testing: 0.8, security: 0.8 },
  'deepseek-code': { architecture: 0.85, coding: 0.9, debugging: 0.95, testing: 0.9, security: 0.9 },
  'kimi-code': { architecture: 0.8, coding: 0.85, debugging: 0.85, testing: 0.8, security: 0.75 },
  zcode: { architecture: 0.9, coding: 0.8, debugging: 0.9, testing: 0.95, security: 0.95 },
};

export interface TaskFeatureWeights {
  architecture?: number;
  coding?: number;
  debugging?: number;
  testing?: number;
  security?: number;
}

export function electSquadLead(candidates: string[], features: TaskFeatureWeights): string {
  if (candidates.length === 0) return 'agy';
  if (candidates.length === 1) return candidates[0];

  const weights: Required<TaskFeatureWeights> = {
    architecture: features.architecture ?? 0.2,
    coding: features.coding ?? 0.2,
    debugging: features.debugging ?? 0.2,
    testing: features.testing ?? 0.2,
    security: features.security ?? 0.2,
  };

  let bestDog = candidates[0];
  let highestScore = -1;

  for (const dog of candidates) {
    const profile = DEFAULT_DOG_CAPABILITIES[dog] || {
      architecture: 0.5,
      coding: 0.5,
      debugging: 0.5,
      testing: 0.5,
      security: 0.5,
    };

    const score =
      profile.architecture * weights.architecture +
      profile.coding * weights.coding +
      profile.debugging * weights.debugging +
      profile.testing * weights.testing +
      profile.security * weights.security;

    if (score > highestScore) {
      highestScore = score;
      bestDog = dog;
    }
  }

  return bestDog;
}

export interface LiquidSquad {
  squad_id: string;
  task_id: string;
  task_description: string;
  lead_dog: string;
  member_dogs: string[];
  status: SquadStatus;
  created_at_utc: string;
  disbanded_at_utc?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export class LiquidSquadEngine {
  private runtimeRoot: string;
  private squadsDir: string;
  private squads: Map<string, LiquidSquad> = new Map();
  private memoryGraph?: SymbolicMemoryGraph;

  constructor(runtimeRoot: string, memoryGraph?: SymbolicMemoryGraph) {
    this.runtimeRoot = path.resolve(runtimeRoot);
    this.squadsDir = path.join(this.runtimeRoot, 'squads');
    this.memoryGraph = memoryGraph;

    if (!existsSync(this.squadsDir)) {
      try {
        mkdirSync(this.squadsDir, { recursive: true });
      } catch {}
    }

    this.loadAll();
  }

  private loadAll(): void {
    if (!existsSync(this.squadsDir)) return;
    try {
      const files = readdirSync(this.squadsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const raw = readFileSync(path.join(this.squadsDir, file), 'utf-8');
            const squad = JSON.parse(raw) as LiquidSquad;
            if (squad && squad.squad_id) {
              this.squads.set(squad.squad_id, squad);
            }
          } catch {}
        }
      }
    } catch {}
  }

  private saveSquad(squad: LiquidSquad): void {
    try {
      if (!existsSync(this.squadsDir)) {
        mkdirSync(this.squadsDir, { recursive: true });
      }
      const filePath = path.join(this.squadsDir, `${squad.squad_id}.json`);
      writeFileSync(filePath, JSON.stringify(squad, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[liquid-squad] failed to save squad ${squad.squad_id}:`, err);
    }
  }

  public formSquad(
    taskId: string,
    taskDesc: string,
    candidateDogs: string[],
    features: TaskFeatureWeights = {}
  ): LiquidSquad {
    const leadDog = electSquadLead(candidateDogs, features);
    const memberDogs = candidateDogs.filter((d) => d !== leadDog);
    const squadId = `squad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const squad: LiquidSquad = {
      squad_id: squadId,
      task_id: taskId,
      task_description: taskDesc,
      lead_dog: leadDog,
      member_dogs: memberDogs,
      status: 'ACTIVE',
      created_at_utc: now,
    };

    this.squads.set(squadId, squad);
    this.saveSquad(squad);
    return squad;
  }

  public listSquads(status?: SquadStatus): LiquidSquad[] {
    const list = Array.from(this.squads.values());
    if (!status) return list;
    return list.filter((s) => s.status === status);
  }

  public getSquad(squadId: string): LiquidSquad | undefined {
    return this.squads.get(squadId);
  }

  public disbandSquad(squadId: string, summary = '任务攻坚完成，小队正常解散'): LiquidSquad {
    const squad = this.squads.get(squadId);
    if (!squad) {
      throw new Error(`Squad not found: ${squadId}`);
    }

    squad.status = 'DISBANDED';
    squad.disbanded_at_utc = new Date().toISOString();
    squad.summary = summary;
    this.saveSquad(squad);

    // 将攻坚结论沉淀至符号记忆图谱
    if (this.memoryGraph) {
      try {
        this.memoryGraph.addNode({
          type: 'decision',
          content: `[Squad ${squad.squad_id}] ${squad.task_description} 达成: ${squad.summary}`,
          tags: ['squad', squad.squad_id, squad.lead_dog, ...squad.member_dogs],
          source_session_id: squad.task_id,
        });
      } catch {}
    }

    return squad;
  }
}
