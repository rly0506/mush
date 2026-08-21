/**
 * GOAL-042: 跨犬直连协作协议与 DAG 调度引擎 (Inter-Agent Direct Protocol)
 */

import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export type AgentPayloadType = 'artifact' | 'status' | 'request';

export interface AgentMessage {
  message_id: string;
  sender: string;      // adapter_id
  receiver: string;    // adapter_id
  payload_type: AgentPayloadType;
  payload: unknown;
  timestamp_utc: string;
}

export type StageStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface DAGStage {
  stage_id: string;
  adapter_id: string;
  depends_on: string[]; // 前置 stage_id
  status: StageStatus;
  output?: unknown;
}

export interface CollaborationDAG {
  task_id: string;
  stages: DAGStage[];
  created_at_utc: string;
}

export class AgentCollaborationHub {
  private runtimeRoot: string;
  private mailboxDir: string;
  private dags: Map<string, CollaborationDAG> = new Map();

  constructor(runtimeRoot?: string) {
    this.runtimeRoot = runtimeRoot ? path.resolve(runtimeRoot) : '';
    this.mailboxDir = this.runtimeRoot ? path.join(this.runtimeRoot, 'agent-mailbox') : '';
    if (this.mailboxDir) {
      try {
        fs.mkdirSync(this.mailboxDir, { recursive: true });
      } catch {}
    }
  }

  /** 发送跨犬直连消息 */
  public sendDirectMessage(
    msg: Omit<AgentMessage, 'message_id' | 'timestamp_utc'>
  ): AgentMessage {
    const fullMsg: AgentMessage = {
      message_id: `msg-${Date.now()}-${randomUUID().slice(0, 6)}`,
      sender: msg.sender,
      receiver: msg.receiver,
      payload_type: msg.payload_type,
      payload: msg.payload,
      timestamp_utc: new Date().toISOString(),
    };

    if (this.mailboxDir) {
      const boxFile = path.join(this.mailboxDir, `${msg.receiver}.jsonl`);
      fs.appendFileSync(boxFile, JSON.stringify(fullMsg) + '\n', 'utf-8');
    }

    return fullMsg;
  }

  /** 读取犬只信箱 */
  public getMailbox(adapterId: string): AgentMessage[] {
    if (!this.mailboxDir) return [];
    const boxFile = path.join(this.mailboxDir, `${adapterId}.jsonl`);
    if (!fs.existsSync(boxFile)) return [];
    try {
      const lines = fs.readFileSync(boxFile, 'utf-8').split('\n').filter((l) => l.trim() !== '');
      return lines.map((l) => JSON.parse(l) as AgentMessage);
    } catch {
      return [];
    }
  }

  /** 注册跨犬协作 DAG 拓扑 */
  public createCollaborationDAG(
    taskId: string,
    stages: Array<{ stage_id: string; adapter_id: string; depends_on?: string[] }>
  ): CollaborationDAG {
    // Kahn 算法拓扑排序检测循环依赖，防止 DAG 死锁
    const graph: Map<string, string[]> = new Map();
    const inDegree: Map<string, number> = new Map();
    for (const s of stages) {
      graph.set(s.stage_id, []);
      inDegree.set(s.stage_id, 0);
    }
    for (const s of stages) {
      const deps = s.depends_on || [];
      inDegree.set(s.stage_id, deps.length);
      for (const dep of deps) {
        if (graph.has(dep)) {
          graph.get(dep)!.push(s.stage_id);
        }
      }
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }
    let visited = 0;
    while (queue.length > 0) {
      const u = queue.shift()!;
      visited++;
      for (const v of graph.get(u) || []) {
        const nextDeg = (inDegree.get(v) ?? 1) - 1;
        inDegree.set(v, nextDeg);
        if (nextDeg === 0) queue.push(v);
      }
    }
    if (visited < stages.length) {
      throw new Error(`Circular dependency detected in DAG stages for task: ${taskId}`);
    }

    const dag: CollaborationDAG = {
      task_id: taskId,
      stages: stages.map((s) => ({
        stage_id: s.stage_id,
        adapter_id: s.adapter_id,
        depends_on: s.depends_on || [],
        status: (s.depends_on && s.depends_on.length > 0) ? 'PENDING' : 'RUNNING',
      })),
      created_at_utc: new Date().toISOString(),
    };
    this.dags.set(taskId, dag);
    return dag;
  }

  /** 推进阶段并自动解锁下游就绪阶段 */
  public advanceDAG(taskId: string, completedStageId: string, output?: unknown): DAGStage[] {
    const dag = this.dags.get(taskId);
    if (!dag) {
      throw new Error(`DAG not found for task: ${taskId}`);
    }

    const currentStage = dag.stages.find((s) => s.stage_id === completedStageId);
    if (currentStage) {
      currentStage.status = 'COMPLETED';
      currentStage.output = output;
    }

    const completedIds = new Set(
      dag.stages.filter((s) => s.status === 'COMPLETED').map((s) => s.stage_id)
    );

    const newlyUnblocked: DAGStage[] = [];
    for (const stage of dag.stages) {
      if (stage.status === 'PENDING') {
        const allDepsSatisfied = stage.depends_on.every((d) => completedIds.has(d));
        if (allDepsSatisfied) {
          stage.status = 'RUNNING';
          newlyUnblocked.push(stage);
        }
      }
    }

    return newlyUnblocked;
  }

  /** 查询 DAG 状态 */
  public getDAGStatus(taskId: string): CollaborationDAG | null {
    return this.dags.get(taskId) ?? null;
  }
}
