import type { AgentMode, Provider } from '../settings/schema.ts';

export function canUseUi(provider: Provider | undefined): boolean {
  return !!provider?.acp?.trim();
}

export function openTabCreateBody(
  base: { cwd?: string; prompt: string; command: string; resume: string },
  provider: Provider | undefined,
  mode: AgentMode,
): {
  cwd?: string;
  prompt: string;
  command: string;
  resume: string;
  mode: AgentMode;
  acp_command?: string;
} {
  const body = { ...base, mode };
  if (mode === 'ui') {
    const acp = provider?.acp?.trim();
    if (acp) return { ...body, acp_command: acp };
  }
  return body;
}
