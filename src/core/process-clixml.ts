/**
 * M1 fixture-reference（非生产实现）：
 * 把黄金参照 gated launcher 的 CLIXML 进度条过滤状态机逐行翻译为 Node/TS 可执行
 * 参考件；M2 由生产实现替换。
 *
 * PS 源（只读）：
 *   D:\意向项目\.agent-bridge\tools\start-goal-orchestrator.ps1
 *     Remove-BridgeProgressClixml L989-L1060
 *   D:\意向项目\.agent-bridge\tools\tests\bridge-process-job.tests.ps1
 *     CLIXML 状态机边角断言 L260-L275（GOAL010-T8-PROCESS-004）
 */

/**
 * 逐行状态机移植（PS L994-L1058，语义等价）：
 * - '#< CLIXML' 开启过滤；同行的 '</Objs>' 关闭过滤并保留其后缀
 * - 跨行 CLIXML 块整体吞掉
 * - 未闭合的块在收尾时把 opener + 被吞内容原样保留（诊断不回退为静默）
 */
export function removeBridgeProgressClixml(text: string): string {
  if (text === null || text === undefined || text.length === 0) return '';
  const lines = text.split(/\r?\n/);
  const builder: string[] = [];
  let inClixml = false;
  const clixmlBuffer: string[] = [];

  const appendLine = (line: string): void => {
    if (builder.length > 0) builder.push('\r\n');
    builder.push(line);
  };

  for (const line of lines) {
    let segment = '';
    if (inClixml) {
      const closeIndex = line.indexOf('</Objs>');
      if (closeIndex < 0) {
        clixmlBuffer.push(line);
        continue;
      }
      inClixml = false;
      clixmlBuffer.length = 0;
      segment = line.substring(closeIndex + '</Objs>'.length);
    } else {
      const markerIndex = line.indexOf('#< CLIXML');
      if (markerIndex < 0) {
        appendLine(line);
        continue;
      }
      if (markerIndex > 0) appendLine(line.substring(0, markerIndex));
      segment = line.substring(markerIndex);
    }

    // 同一剩余段上继续走 marker/close；同行的第二个 opener 开启新块。
    while (segment.length > 0) {
      const markerIndex = segment.indexOf('#< CLIXML');
      if (markerIndex < 0) {
        appendLine(segment);
        segment = '';
        continue;
      }
      if (markerIndex > 0) appendLine(segment.substring(0, markerIndex));
      const openTail = segment.substring(markerIndex);
      const closeIndex = openTail.indexOf('</Objs>');
      if (closeIndex < 0) {
        inClixml = true;
        clixmlBuffer.push(openTail);
        segment = '';
        continue;
      }
      segment = openTail.substring(closeIndex + '</Objs>'.length);
    }
  }

  if (inClixml && clixmlBuffer.length > 0) {
    appendLine(clixmlBuffer.join('\r\n'));
  }
  return builder.join('');
}
