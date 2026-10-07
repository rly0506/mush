/** Synthetic asset binding for HTTP fixtures; version inspection must also be injected. */
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validateAdapterContract, type AdapterContract } from '../../src/adapters/contract.ts';

export function withFixtureDiscussionProfile(contract: AdapterContract, root: string): AdapterContract {
  mkdirSync(root, { recursive: true });
  const bytes = JSON.stringify({ models: [{ slug: contract.expected_model_id }] });
  const hash = createHash('sha256').update(bytes).digest('hex');
  const file = path.join(root, 'catalog-' + hash + '.json');
  writeFileSync(file, bytes);
  return validateAdapterContract({ ...contract,
    codex_discussion_profile: { model_id: contract.expected_model_id, native_version: 'fixture-version',
      catalog_path: file, catalog_sha256: hash } });
}
export const fixtureDiscussionInspector = async () => ({ nativeVersion: 'fixture-version', mcps: [] });

export function fixtureDiscussionInputs(root: string) {
  const workspace = path.join(root, 'runtime/agy-workspace');
  const agentFile = path.join(workspace, '.agents/agents/mush-discussion.md');
  mkdirSync(path.dirname(agentFile), {recursive:true});
  const projectFile = path.join(root, 'runtime/agy-project.json');
  const projectId = 'bb254da4-c36e-4f99-8801-599547824e0c';
  writeFileSync(projectFile, JSON.stringify({ id:projectId, projectResources:{resources:[{folderUri:'file://' + workspace.replaceAll('\\','/')}]},
    permissionGrants:{permissionGrants:{deny:['read_file(*)','write_file(*)','command(*)','mcp(*)','read_url(*)','execute_url(*)','unsandboxed(*)']}} }));
  writeFileSync(agentFile, '---\nname: mush-discussion\ndescription: fixture\ntools: []\nmainAgent: true\nsubagent: false\ncommandExecutionPolicy: off\nmcpServers: []\nskills: []\nplugins: []\n---\nFixture.');
  const gate = path.join(workspace, '.agents/deny-tools.mjs');
  copyFileSync(path.resolve('src/adapters/agy-discussion-gate.mjs'), gate);
  writeFileSync(path.join(workspace,'.agents/hooks.json'),JSON.stringify({'mush-controlled-discussion':{enabled:true,
    PreToolUse:[{matcher:'*',hooks:[{type:'command',command:'node '+gate.replaceAll('\\','/'),timeout:5}]}]}}));
  return {
    codexDiscussionInputs: async () => ({nativeVersion:'fixture-version',mcpNames:[],catalog:{models:[{slug:'gpt-5.5'}]}}),
    codexDiscussionInspector: fixtureDiscussionInspector,
    agyDiscussionInputs: () => ({workspace,projectId,projectFile,agentFile,nativeVersion:'fixture-version',modelId:'gemini-3.7-flash-high'}),
    agyDiscussionInspector: async () => 'fixture-version',
  };
}
