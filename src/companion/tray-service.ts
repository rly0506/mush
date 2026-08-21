/**
 * GOAL-054: 极简系统托盘常驻伴侣与全局热键雪橇浮窗内核 (Desktop Companion & Tray Service)
 */

export type CompanionStatus = 'IDLE' | 'BUSY' | 'PENDING_APPROVAL' | 'ERROR';

export type QuickActionType = 'DEBATE' | 'REVIEW' | 'PIPELINE' | 'EXPLAIN' | 'TEST';

export interface QuickActionPayload {
  action_type: QuickActionType;
  prompt: string;
  selected_code?: string;
  head_dog?: string;
  workspace_root?: string;
}

export class FloatingSledCompanion {
  public serverUrl: string;
  public callerToken?: string;
  public status: CompanionStatus = 'IDLE';
  public hotkey = 'Alt+Space';
  public isWindowVisible = false;
  public pendingApprovalId?: string;

  constructor(serverUrl: string, callerToken?: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.callerToken = callerToken;
  }

  public showWindow(): void {
    this.isWindowVisible = true;
  }

  public hideWindow(): void {
    this.isWindowVisible = false;
  }

  public toggleWindow(): boolean {
    this.isWindowVisible = !this.isWindowVisible;
    return this.isWindowVisible;
  }

  public handleApprovalNotification(approvalId: string): void {
    this.pendingApprovalId = approvalId;
    this.status = 'PENDING_APPROVAL';
  }

  public async triggerQuickAction(payload: QuickActionPayload): Promise<{ ok: boolean; dispatch_id?: string; mode: string; error?: string }> {
    this.status = 'BUSY';
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (this.callerToken) {
        headers['x-mush-caller-auth'] = this.callerToken;
      }

      const res = await fetch(`${this.serverUrl}/api/companion/quick-action`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { ok: boolean; dispatch_id?: string; mode?: string; error?: string };
      this.status = 'IDLE';
      return {
        ok: data.ok,
        dispatch_id: data.dispatch_id,
        mode: data.mode || payload.action_type,
        error: data.error,
      };
    } catch (err) {
      this.status = 'ERROR';
      return {
        ok: false,
        mode: payload.action_type,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async respondToApproval(approvalId: string, decision: 'APPROVED' | 'DENIED'): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (this.callerToken) {
        headers['x-mush-caller-auth'] = this.callerToken;
      }

      const res = await fetch(`${this.serverUrl}/api/approvals/respond`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          request_id: approvalId,
          decision,
        }),
      });

      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        this.pendingApprovalId = undefined;
        this.status = 'IDLE';
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
