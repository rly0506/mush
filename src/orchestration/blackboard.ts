/**
 * GOAL-050: 跨犬共享黑板协作空间与读写白名单仲裁 (Shared Blackboard Engine)
 */

import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export type BlackboardSection = 'artifacts' | 'issues' | 'hypotheses' | 'decisions';

export type BlackboardPermission = 'read' | 'append' | 'write';

export interface BlackboardItem {
  id: string;
  section: BlackboardSection;
  title: string;
  content: string;
  author_dog: string;
  version: number;
  tags: string[];
  timestamp_utc: string;
  metadata?: Record<string, unknown>;
}

export interface BlackboardAclRule {
  dog: string;
  section: BlackboardSection;
  permission: BlackboardPermission;
}

export class BlackboardAclError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlackboardAclError';
  }
}

export interface BlackboardEvent {
  type: 'item_added' | 'item_updated';
  item: BlackboardItem;
  section: BlackboardSection;
}

export class BlackboardEngine {
  private runtimeRoot: string;
  private storagePath: string;
  private items: Map<string, BlackboardItem> = new Map();
  private aclRules: Map<string, BlackboardPermission> = new Map(); // "dog:section" -> permission
  private subscribers: Map<BlackboardSection, Set<(event: BlackboardEvent) => void>> = new Map();

  constructor(runtimeRoot: string, aclRules: BlackboardAclRule[] = []) {
    this.runtimeRoot = path.resolve(runtimeRoot);
    this.storagePath = path.join(this.runtimeRoot, 'blackboard', 'items.json');

    const dir = path.dirname(this.storagePath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {}
    }

    for (const r of aclRules) {
      this.setAcl(r.dog, r.section, r.permission);
    }

    this.loadAll();
  }

  public setAcl(dog: string, section: BlackboardSection, permission: BlackboardPermission): void {
    this.aclRules.set(`${dog}:${section}`, permission);
  }

  public getPermission(dog: string, section: BlackboardSection): BlackboardPermission {
    return this.aclRules.get(`${dog}:${section}`) ?? 'write';
  }

  private loadAll(): void {
    if (!existsSync(this.storagePath)) return;
    try {
      const raw = readFileSync(this.storagePath, 'utf-8');
      const list = JSON.parse(raw) as BlackboardItem[];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.id) {
            this.items.set(item.id, item);
          }
        }
      }
    } catch {}
  }

  private saveAll(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const list = Array.from(this.items.values());
      writeFileSync(this.storagePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[blackboard] failed to save items:', err);
    }
  }

  public getSectionItems(section: BlackboardSection): BlackboardItem[] {
    return Array.from(this.items.values()).filter((item) => item.section === section);
  }

  public getAllItems(): Record<BlackboardSection, BlackboardItem[]> {
    return {
      artifacts: this.getSectionItems('artifacts'),
      issues: this.getSectionItems('issues'),
      hypotheses: this.getSectionItems('hypotheses'),
      decisions: this.getSectionItems('decisions'),
    };
  }

  public getItem(id: string): BlackboardItem | undefined {
    return this.items.get(id);
  }

  public writeItem(
    authorDog: string,
    section: BlackboardSection,
    title: string,
    content: string,
    tags: string[] = [],
    metadata?: Record<string, unknown>
  ): BlackboardItem {
    const perm = this.getPermission(authorDog, section);
    if (perm === 'read') {
      throw new BlackboardAclError(
        `Permission denied: dog '${authorDog}' has read-only permission on blackboard section '${section}'`
      );
    }

    const now = new Date().toISOString();

    // 查找同一分区下同名条目进行版本自增更新
    let existing: BlackboardItem | undefined;
    for (const it of this.items.values()) {
      if (it.section === section && it.title === title) {
        existing = it;
        break;
      }
    }

    let resultItem: BlackboardItem;
    let eventType: 'item_added' | 'item_updated' = 'item_added';

    if (existing) {
      existing.content = content;
      existing.author_dog = authorDog;
      existing.version += 1;
      existing.tags = Array.from(new Set([...existing.tags, ...tags]));
      existing.timestamp_utc = now;
      if (metadata) existing.metadata = { ...existing.metadata, ...metadata };
      resultItem = existing;
      eventType = 'item_updated';
    } else {
      const id = `bb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      resultItem = {
        id,
        section,
        title,
        content,
        author_dog: authorDog,
        version: 1,
        tags,
        timestamp_utc: now,
        metadata,
      };
      this.items.set(id, resultItem);
    }

    this.saveAll();
    this.notifySubscribers({
      type: eventType,
      item: resultItem,
      section,
    });

    return resultItem;
  }

  public subscribe(section: BlackboardSection, listener: (event: BlackboardEvent) => void): () => void {
    if (!this.subscribers.has(section)) {
      this.subscribers.set(section, new Set());
    }
    const set = this.subscribers.get(section)!;
    set.add(listener);

    return () => {
      set.delete(listener);
    };
  }

  private notifySubscribers(event: BlackboardEvent): void {
    const set = this.subscribers.get(event.section);
    if (set) {
      for (const listener of set) {
        try {
          listener(event);
        } catch (err) {
          console.warn('[blackboard] subscriber error:', err);
        }
      }
    }
  }
}
