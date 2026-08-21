/**
 * GOAL-042: 符号化记忆图谱引擎 (Symbolic Memory Graph)
 */

import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export type MemoryNodeType = 'decision' | 'constraint' | 'file_change' | 'api_change' | 'test_result' | 'summary';
export type MemoryRelation = 'depends_on' | 'supersedes' | 'caused_by' | 'relates_to';

export interface MemoryNode {
  node_id: string;
  type: MemoryNodeType;
  content: string;
  tags: string[];
  source_session_id?: string;
  created_at_utc: string;
  decay_level: 0 | 1 | 2 | 3; // 0=鲜活 -> 3=归档摘要
}

export interface MemoryEdge {
  from: string; // node_id
  to: string;   // node_id
  relation: MemoryRelation;
}

export class SymbolicMemoryGraph {
  public nodes: Map<string, MemoryNode> = new Map();
  public edges: MemoryEdge[] = [];
  private runtimeRoot: string;
  private filePath: string;

  constructor(runtimeRoot?: string) {
    this.runtimeRoot = runtimeRoot ? path.resolve(runtimeRoot) : '';
    this.filePath = this.runtimeRoot ? path.join(this.runtimeRoot, 'memory-graph.json') : '';
    if (this.filePath && fs.existsSync(this.filePath)) {
      this.loadGraph();
    }
  }

  public addNode(node: Omit<MemoryNode, 'node_id' | 'created_at_utc' | 'decay_level'> & { node_id?: string }): MemoryNode {
    const fullNode: MemoryNode = {
      node_id: node.node_id || `node-${Date.now()}-${randomUUID().slice(0, 6)}`,
      type: node.type,
      content: node.content,
      tags: Array.isArray(node.tags) ? node.tags : [],
      source_session_id: node.source_session_id,
      created_at_utc: new Date().toISOString(),
      decay_level: 0,
    };
    this.nodes.set(fullNode.node_id, fullNode);
    this.saveGraph();
    return fullNode;
  }

  public addEdge(from: string, to: string, relation: MemoryRelation): MemoryEdge {
    if (!this.nodes.has(from) || !this.nodes.has(to)) {
      throw new Error(`Cannot connect non-existent nodes: from=${from}, to=${to}`);
    }
    const edge: MemoryEdge = { from, to, relation };
    this.edges.push(edge);
    this.saveGraph();
    return edge;
  }

  public getNode(nodeId: string): MemoryNode | null {
    return this.nodes.get(nodeId) ?? null;
  }

  public queryByTags(tags: string[], limit = 20): MemoryNode[] {
    const lowerTags = tags.map((t) => t.toLowerCase());
    const matches: MemoryNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.tags.some((t) => lowerTags.includes(t.toLowerCase()))) {
        matches.push(node);
      }
    }
    return matches.slice(0, limit);
  }

  public queryByFile(filePath: string): MemoryNode[] {
    const norm = filePath.replace(/\\/g, '/');
    const matches: MemoryNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.content.includes(norm) || node.tags.includes(norm)) {
        matches.push(node);
      }
    }
    return matches;
  }

  public applyDecay(): number {
    let decayedCount = 0;
    for (const node of this.nodes.values()) {
      if (node.decay_level < 3) {
        node.decay_level = (node.decay_level + 1) as 0 | 1 | 2 | 3;
        decayedCount++;
      }
    }
    this.saveGraph();
    return decayedCount;
  }

  public saveGraph(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  public loadGraph(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as { nodes: MemoryNode[]; edges: MemoryEdge[] };
      this.nodes.clear();
      for (const n of parsed.nodes) {
        this.nodes.set(n.node_id, n);
      }
      this.edges = parsed.edges || [];
    } catch {}
  }
}
