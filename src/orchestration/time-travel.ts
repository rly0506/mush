/**
 * GOAL-049: 会话与代码时空状态树与因果时间旅行快照内核 (Time-Travel Kernel)
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolveInsideWorkspace } from '../core/path-guard.ts';

export interface StateFileSnapshot {
  relative_path: string;
  hash: string;
  content: string;
}

export interface StateNode {
  node_id: string;
  parent_id?: string;
  branch_name: string;
  reason: string;
  timestamp_utc: string;
  files: StateFileSnapshot[];
  metadata?: Record<string, unknown>;
}

export class TimeTravelKernel {
  private workspaceRoot: string;
  private runtimeRoot: string;
  private storagePath: string;
  private nodes: Map<string, StateNode> = new Map();
  private branchHeads: Map<string, string> = new Map(); // branchName -> latestNodeId

  constructor(workspaceRoot: string, runtimeRoot?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.runtimeRoot = path.resolve(runtimeRoot ?? this.workspaceRoot);
    this.storagePath = path.join(this.runtimeRoot, 'time-travel', 'nodes.json');

    const ttDir = path.dirname(this.storagePath);
    if (!existsSync(ttDir)) {
      try {
        mkdirSync(ttDir, { recursive: true });
      } catch {}
    }
    this.loadAll();
  }

  private loadAll(): void {
    if (!existsSync(this.storagePath)) return;
    try {
      const raw = readFileSync(this.storagePath, 'utf-8');
      const list = JSON.parse(raw) as StateNode[];
      if (Array.isArray(list)) {
        for (const node of list) {
          if (node && node.node_id) {
            this.nodes.set(node.node_id, node);
            this.branchHeads.set(node.branch_name, node.node_id);
          }
        }
      }
    } catch {}
  }

  private saveAll(): void {
    try {
      const ttDir = path.dirname(this.storagePath);
      if (!existsSync(ttDir)) {
        mkdirSync(ttDir, { recursive: true });
      }
      const list = Array.from(this.nodes.values());
      writeFileSync(this.storagePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[time-travel] failed to save nodes:', err);
    }
  }

  public createSnapshot(
    reason: string,
    trackedRelFiles: string[] = [],
    branchName = 'main',
    parentId?: string
  ): StateNode {
    const parent = parentId || this.branchHeads.get(branchName);
    const nodeId = `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const fileSnapshots: StateFileSnapshot[] = [];

    for (const rel of trackedRelFiles) {
      const normRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
      // GOAL-067（P1-7）：读侧边界——拒绝 ../ 与绝对路径逃逸，任意文件不得
      // 被吸入快照（写侧早有防线，读侧此前完全开放）。
      const fullPath = resolveInsideWorkspace(this.workspaceRoot, normRel);
      if (fullPath === null) continue;
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
          fileSnapshots.push({
            relative_path: normRel,
            hash,
            content,
          });
        } catch {}
      }
    }

    const node: StateNode = {
      node_id: nodeId,
      parent_id: parent,
      branch_name: branchName,
      reason,
      timestamp_utc: now,
      files: fileSnapshots,
    };

    this.nodes.set(nodeId, node);
    this.branchHeads.set(branchName, nodeId);
    this.saveAll();
    return node;
  }

  public getNode(nodeId: string): StateNode | undefined {
    return this.nodes.get(nodeId);
  }

  public listNodes(): StateNode[] {
    return Array.from(this.nodes.values()).sort(
      (a, b) => new Date(a.timestamp_utc).getTime() - new Date(b.timestamp_utc).getTime()
    );
  }

  public getTree(): { nodes: StateNode[]; branches: Record<string, StateNode[]> } {
    const nodes = this.listNodes();
    const branches: Record<string, StateNode[]> = {};

    for (const node of nodes) {
      if (!branches[node.branch_name]) {
        branches[node.branch_name] = [];
      }
      branches[node.branch_name].push(node);
    }

    return { nodes, branches };
  }

  public forkBranch(fromNodeId: string, newBranchName: string, reason: string): StateNode {
    const sourceNode = this.nodes.get(fromNodeId);
    if (!sourceNode) {
      throw new Error(`Source node not found for fork: ${fromNodeId}`);
    }

    const nodeId = `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const forkedNode: StateNode = {
      node_id: nodeId,
      parent_id: fromNodeId,
      branch_name: newBranchName,
      reason: `Fork from ${fromNodeId}: ${reason}`,
      timestamp_utc: now,
      files: sourceNode.files.map((f) => ({ ...f })),
    };

    this.nodes.set(nodeId, forkedNode);
    this.branchHeads.set(newBranchName, nodeId);
    this.saveAll();
    return forkedNode;
  }

  public travelToNode(nodeId: string): { ok: boolean; restored_files_count: number; active_node: StateNode } {
    const targetNode = this.nodes.get(nodeId);
    if (!targetNode) {
      throw new Error(`State node not found: ${nodeId}`);
    }

    let restoredCount = 0;

    for (const f of targetNode.files) {
      // 安全防线（F-AUD-03 标准，GOAL-067 统一走 path-guard）：禁止路径穿越
      // （含兄弟目录前缀绕过）与意向项目写入。
      const fullPath = resolveInsideWorkspace(this.workspaceRoot, f.relative_path);
      if (fullPath === null || fullPath.includes('意向项目')) {
        continue;
      }

      try {
        const parentDir = path.dirname(fullPath);
        if (!existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }
        writeFileSync(fullPath, f.content, 'utf-8');
        restoredCount++;
      } catch (err) {
        console.warn(`[time-travel] failed to restore file ${fullPath}:`, err);
      }
    }

    this.branchHeads.set(targetNode.branch_name, targetNode.node_id);
    return {
      ok: true,
      restored_files_count: restoredCount,
      active_node: targetNode,
    };
  }
}
