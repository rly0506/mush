/**
 * GOAL-028 / GP-38 多组织拓扑与 LLM-as-a-Verifier 独立验证矩阵测试
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  runStaticSecurityAudit,
  runStaticSpecAudit,
  runVerifier,
  VerifierDecouplingError,
} from '../src/orchestration/verifier.ts';
import {
  executePipelineSOP,
  executeCommitteeDebate,
} from '../src/orchestration/topology.ts';
import { DispatchPipeline } from '../src/web/dispatch.ts';
import { renderBoardPage } from '../src/web/page.ts';

describe('GOAL-028: Multi-Topology and LLM Verifiers', () => {
  let tmpDir: string;
  let approvalRoot: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-test-g028-'));
    approvalRoot = path.join(tmpDir, 'runtime', 'approvals');
    ledgerPath = path.join(tmpDir, 'runtime', 'budget-ledger.jsonl');
    mkdirSync(approvalRoot, { recursive: true });
    mkdirSync(path.dirname(ledgerPath), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('1. Verifier Decoupling & Security Audits', () => {
    test('Static security audit catches hardcoded tokens and dangerous commands', () => {
      const badSnippet1 = 'const key = "sk-1234567890abcdef1234567890abcdef";';
      const sec1 = runStaticSecurityAudit(badSnippet1);
      assert.strictEqual(sec1.decision, 'FAIL');
      assert.ok(sec1.issues.some((i) => i.includes('硬编码 API Token')));

      const badSnippet2 = 'rm -rf / --no-preserve-root';
      const sec2 = runStaticSecurityAudit(badSnippet2);
      assert.strictEqual(sec2.decision, 'FAIL');
      assert.ok(sec2.issues.some((i) => i.includes('高危系统擦除指令')));

      const cleanSnippet = 'export function add(a: number, b: number) { return a + b; }';
      const secClean = runStaticSecurityAudit(cleanSnippet);
      assert.strictEqual(secClean.decision, 'PASS');
      assert.strictEqual(secClean.issues.length, 0);
    });

    test('runVerifier enforces Generator !== Verifier (Decoupling Law)', async () => {
      // 1. Same dog for generator and verifier -> Throws VerifierDecouplingError
      await assert.rejects(
        async () => {
          await runVerifier({
            generatorId: 'claude-code',
            verifierId: 'claude-code',
            facet: 'SECURITY',
            prompt: 'Write code',
            artifactContent: 'clean code',
          });
        },
        (err: Error) => {
          assert.ok(err instanceof VerifierDecouplingError);
          assert.ok(err.message.includes('不得为同一犬只'));
          return true;
        },
      );

      // 2. Heterogeneous dog -> Passes and returns structured VerifierReport
      const report = await runVerifier({
        generatorId: 'claude-code',
        verifierId: 'deepseek-dsh',
        facet: 'SECURITY',
        prompt: 'Write code',
        artifactContent: 'export const hello = "world";',
        now: () => new Date('2026-08-19T01:00:00Z'),
      });

      assert.strictEqual(report.decision, 'PASS');
      assert.strictEqual(report.generator_adapter_id, 'claude-code');
      assert.strictEqual(report.verifier_adapter_id, 'deepseek-dsh');
      assert.strictEqual(report.facet, 'SECURITY');
      assert.strictEqual(report.verified_at_utc, '2026-08-19T01:00:00.000Z');
    });
  });

  describe('2. Multi-Topology Orchestration', () => {
    test('executePipelineSOP passes artifacts sequentially across Spec -> Code -> Test -> Audit', async () => {
      const stepExecutionLog: string[] = [];
      const result = await executePipelineSOP({
        initialPrompt: 'Feature: Calculator',
        pipelineSteps: [
          { step_name: 'SPEC', dog_id: 'zcode' },
          { step_name: 'CODE', dog_id: 'claude-code' },
          { step_name: 'TEST', dog_id: 'pi' },
        ],
        runStep: async (dogId, prompt) => {
          stepExecutionLog.push(`${dogId}: ${prompt.slice(0, 30)}`);
          return { output: `[Output from ${dogId}]: Done`, exitCode: 0 };
        },
      });

      assert.strictEqual(result.mode, 'PIPELINE_SOP');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.steps.length, 3);
      assert.strictEqual(result.steps[0].dog_id, 'zcode');
      assert.strictEqual(result.steps[1].dog_id, 'claude-code');
      assert.strictEqual(result.steps[2].dog_id, 'pi');
      assert.ok(result.final_artifact.includes('Output from pi'));
    });

    test('executeCommitteeDebate executes multi-round cross-examination between Proponent and Opponent', async () => {
      const debateRounds: string[] = [];
      const result = await executeCommitteeDebate({
        topic: 'Adopt Zero-Token Ladder vs Periodic Active Pings',
        proponentDogId: 'claude-code',
        opponentDogId: 'deepseek-dsh',
        maxRounds: 2,
        runTurn: async (dogId, context) => {
          debateRounds.push(dogId);
          return { argument: `Argument from ${dogId}`, exitCode: 0 };
        },
      });

      assert.strictEqual(result.mode, 'COMMITTEE_DEBATE');
      assert.strictEqual(result.rounds.length, 4); // 2 rounds * 2 dogs = 4 turns
      assert.strictEqual(result.proponent_dog_id, 'claude-code');
      assert.strictEqual(result.opponent_dog_id, 'deepseek-dsh');
      assert.ok(result.consensus.length > 0);
      assert.strictEqual(result.recommendation, 'NEEDS_OWNER');
    });
  });

  describe('3. Dispatch Pipeline Integration with Topology & Verifiers', () => {
    test('Dispatch pipeline records topology_mode and attaches verifier_report on completion', async () => {
      const pipeline = new DispatchPipeline({
        workspaceRoot: tmpDir,
        approvalRoot,
        ledgerPath,
        now: () => new Date('2026-08-19T00:00:00Z'),
        runAdapter: async () => {
          return { exitCode: 0, stdout: 'export const valid = true;', stderr: '', timedOut: false, childKilled: false };
        },
      });

      const record = await pipeline.dispatch({
        adapter_id: 'claude-code',
        prompt: 'Build calculator',
        effort: 'HIGH',
        workspace: tmpDir,
        timeout_s: 30,
        cap_usd: 5,
        real: false,
        topology_mode: 'PIPELINE_SOP',
        verifier_dog: 'deepseek-dsh',
      });

      assert.strictEqual(record.status, 'DRY_RUN');
      assert.strictEqual(record.topology_mode, 'PIPELINE_SOP');
      assert.ok(record.verifier_report, 'Verifier report should be present');
      assert.strictEqual(record.verifier_report?.decision, 'PASS');
      assert.strictEqual(record.verifier_report?.verifier_adapter_id, 'deepseek-dsh');
      assert.strictEqual(record.verifier_report?.generator_adapter_id, 'claude-code');
    });

    test('Dispatch pipeline rejects self-verification with VerifierDecouplingError', async () => {
      const pipeline = new DispatchPipeline({
        workspaceRoot: tmpDir,
        approvalRoot,
        ledgerPath,
      });

      await assert.rejects(
        async () => {
          await pipeline.dispatch({
            adapter_id: 'claude-code',
            prompt: 'Build calculator',
            effort: 'HIGH',
            workspace: tmpDir,
            timeout_s: 30,
            cap_usd: 5,
            real: false,
            verifier_dog: 'claude-code', // Violation!
          });
        },
        (err: Error) => {
          assert.ok(err instanceof VerifierDecouplingError);
          return true;
        },
      );
    });
  });

  describe('4. Board UI Rendering', () => {
    test('Page script renders topology selector and verifier dropdown', () => {
      const html = renderBoardPage();
      assert.ok(html.includes('id="dispatch-topology"'));
      assert.ok(html.includes('PIPELINE_SOP'));
      assert.ok(html.includes('COMMITTEE_DEBATE'));
      assert.ok(html.includes('BOUNTY_MARKET'));
      assert.ok(html.includes('id="dispatch-verifier"'));
    });
  });
});
