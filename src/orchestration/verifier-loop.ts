/**
 * GOAL-046: 红蓝对抗验证室与闭环自动打回流引擎 (Red-Blue Verifier Loop)
 */

import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
// GOAL-067（P3）：同名错误类双定义会让 instanceof 互相失明（server 只识别本
// 文件变体，dispatch 抛的是 verifier.ts 变体）——统一单源于 verifier.ts。
export { VerifierDecouplingError } from './verifier.ts';
import { VerifierDecouplingError } from './verifier.ts';

export interface AttackTestCase {
  test_name: string;
  test_code: string;
  attack_type: 'fuzzing' | 'concurrency' | 'boundary' | 'security' | 'memory';
  notes?: string;
}

export interface FailedTestReport {
  test_name: string;
  error_message: string;
  stack_trace?: string;
}

export interface CodeArtifact {
  summary: string;
  code: string;
  files?: string[];
  metadata?: Record<string, unknown>;
}

export interface VerificationRound {
  round: number;
  blue_code: CodeArtifact;
  red_attack_cases: AttackTestCase[];
  passed: boolean;
  failed_tests?: FailedTestReport[];
  feedback_to_generator?: string;
  created_at_utc: string;
}

export interface RedBlueSession {
  session_id: string;
  task_title: string;
  workspace_root: string;
  generator_dog: string; // 蓝方生成犬
  verifier_dog: string;  // 红方验证犬
  status: 'IN_PROGRESS' | 'PASSED' | 'FAILED_CIRCUIT_BREAKER' | 'ABORTED';
  max_retries: number;   // 最大重试轮次（熔断上限，默认 3）
  current_round: number; // 当前轮次
  rounds: VerificationRound[];
  final_summary?: string;
  created_at_utc: string;
  updated_at_utc: string;
}

export interface CreateRedBlueSessionParams {
  taskTitle: string;
  workspaceRoot: string;
  generatorDog: string;
  verifierDog: string;
  initialCode: CodeArtifact;
  maxRetries?: number;
}

export class VerifierLoopEngine {
  private runtimeRoot: string;
  private verificationsDir: string;
  private cache: Map<string, RedBlueSession> = new Map();

  constructor(runtimeRoot: string) {
    this.runtimeRoot = runtimeRoot;
    this.verificationsDir = path.join(runtimeRoot, 'verifications');
    if (!existsSync(this.verificationsDir)) {
      try {
        mkdirSync(this.verificationsDir, { recursive: true });
      } catch {}
    }
    this.loadAll();
  }

  private loadAll(): void {
    if (!existsSync(this.verificationsDir)) return;
    try {
      const files = readdirSync(this.verificationsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const raw = readFileSync(path.join(this.verificationsDir, file), 'utf-8');
            const data = JSON.parse(raw) as RedBlueSession;
            if (data && data.session_id) {
              this.cache.set(data.session_id, data);
            }
          } catch {}
        }
      }
    } catch {}
  }

  public createSession(params: CreateRedBlueSessionParams): RedBlueSession {
    if (params.generatorDog === params.verifierDog) {
      throw new VerifierDecouplingError(
        `Generator dog (${params.generatorDog}) cannot be the same as Verifier dog (${params.verifierDog})`
      );
    }

    const sessionId = `verify-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const initialRound: VerificationRound = {
      round: 1,
      blue_code: params.initialCode,
      red_attack_cases: [],
      passed: false,
      created_at_utc: now,
    };

    const session: RedBlueSession = {
      session_id: sessionId,
      task_title: params.taskTitle,
      workspace_root: params.workspaceRoot,
      generator_dog: params.generatorDog,
      verifier_dog: params.verifierDog,
      status: 'IN_PROGRESS',
      max_retries: params.maxRetries ?? 3,
      current_round: 1,
      rounds: [initialRound],
      created_at_utc: now,
      updated_at_utc: now,
    };

    this.cache.set(sessionId, session);
    this.saveSession(session);
    return session;
  }

  public getSession(sessionId: string): RedBlueSession | undefined {
    return this.cache.get(sessionId);
  }

  public listSessions(): RedBlueSession[] {
    return Array.from(this.cache.values()).sort(
      (a, b) => new Date(b.created_at_utc).getTime() - new Date(a.created_at_utc).getTime()
    );
  }

  public submitAttackRound(
    sessionId: string,
    params: {
      redCases: AttackTestCase[];
      passed: boolean;
      failedTests?: FailedTestReport[];
      feedback?: string;
    }
  ): RedBlueSession {
    const session = this.cache.get(sessionId);
    if (!session) {
      throw new Error(`Red-blue verification session not found: ${sessionId}`);
    }

    const currentRound = session.rounds[session.current_round - 1];
    if (!currentRound) {
      throw new Error(`Round ${session.current_round} not found in session: ${sessionId}`);
    }

    const now = new Date().toISOString();
    currentRound.red_attack_cases = params.redCases;
    currentRound.passed = params.passed;
    currentRound.failed_tests = params.failedTests || [];
    currentRound.feedback_to_generator = params.feedback;

    if (params.passed) {
      session.status = 'PASSED';
      session.final_summary = '红方所有破坏性用例与边界攻击已全量验证通过（全绿通过）';
    } else {
      if (session.current_round >= session.max_retries) {
        session.status = 'FAILED_CIRCUIT_BREAKER';
        session.final_summary = `达到最大打回重试上限（${session.max_retries} 轮），触发紧急熔断保护，等待人工介入`;
      } else {
        session.status = 'IN_PROGRESS';
      }
    }

    session.updated_at_utc = now;
    this.saveSession(session);
    return session;
  }

  public submitBlueCorrection(sessionId: string, params: { codeArtifact: CodeArtifact }): RedBlueSession {
    const session = this.cache.get(sessionId);
    if (!session) {
      throw new Error(`Red-blue verification session not found: ${sessionId}`);
    }

    if (session.status !== 'IN_PROGRESS') {
      throw new Error(`Cannot submit blue correction in terminal status: ${session.status}`);
    }

    const now = new Date().toISOString();
    const nextRoundNum = session.current_round + 1;

    const nextRound: VerificationRound = {
      round: nextRoundNum,
      blue_code: params.codeArtifact,
      red_attack_cases: [],
      passed: false,
      created_at_utc: now,
    };

    session.current_round = nextRoundNum;
    session.rounds.push(nextRound);
    session.updated_at_utc = now;

    this.saveSession(session);
    return session;
  }

  private saveSession(session: RedBlueSession): void {
    try {
      if (!existsSync(this.verificationsDir)) {
        mkdirSync(this.verificationsDir, { recursive: true });
      }
      const filePath = path.join(this.verificationsDir, `${session.session_id}.json`);
      writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[verifier-loop] failed to persist verification session:', err);
    }
  }
}
