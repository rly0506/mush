/**
 * mush 本地附件与图片存储服务（支持多模态视觉审查与本地无感落盘）
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface AttachmentInput {
  name: string;
  data: string; // base64 string or data:image/...;base64,...
  type?: string;
}

export interface StoredAttachment {
  id: string;
  name: string;
  url: string;
  localPath: string;
  mimeType: string;
  sizeBytes: number;
}

export function saveAttachment(runtimeRoot: string, input: AttachmentInput): StoredAttachment {
  const dir = path.join(path.resolve(runtimeRoot), 'attachments');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let base64Data = input.data;
  let mimeType = input.type || 'image/png';

  // 处理 data URL 头部（如 data:image/png;base64,...）
  const match = /^data:([^;]+);base64,(.+)$/.exec(input.data);
  if (match) {
    mimeType = match[1];
    base64Data = match[2];
  }
  if (base64Data.length > 25 * 1024 * 1024) {
    throw new Error('Attachment data exceeds maximum allowed size (15MB)');
  }
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 15 * 1024 * 1024) {
    throw new Error('Attachment size exceeds 15MB limit');
  }
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  
  // 提取扩展名
  let ext = '.png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = '.jpg';
  else if (mimeType.includes('gif')) ext = '.gif';
  else if (mimeType.includes('webp')) ext = '.webp';
  else if (mimeType.includes('svg')) ext = '.svg';
  else if (input.name && path.extname(input.name)) ext = path.extname(input.name);

  const filename = `att_${hash}${ext}`;
  const localPath = path.join(dir, filename);

  if (!existsSync(localPath)) {
    writeFileSync(localPath, buffer);
  }

  return {
    id: filename,
    name: input.name || filename,
    url: `/api/attachments/${filename}`,
    localPath,
    mimeType,
    sizeBytes: buffer.length,
  };
}

export function readAttachment(runtimeRoot: string, filename: string): { buffer: Buffer; mimeType: string } | null {
  // 安全校验：防路径穿越
  const safeFilename = path.basename(filename);
  if (safeFilename !== filename) return null;

  const localPath = path.join(path.resolve(runtimeRoot), 'attachments', safeFilename);
  if (!existsSync(localPath)) return null;

  const buffer = readFileSync(localPath);
  let mimeType = 'image/png';
  if (safeFilename.endsWith('.jpg') || safeFilename.endsWith('.jpeg')) mimeType = 'image/jpeg';
  else if (safeFilename.endsWith('.gif')) mimeType = 'image/gif';
  else if (safeFilename.endsWith('.webp')) mimeType = 'image/webp';
  else if (safeFilename.endsWith('.svg')) mimeType = 'image/svg+xml';

  return { buffer, mimeType };
}
