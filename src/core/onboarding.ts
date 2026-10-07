interface OnboardingAdapter {
  adapter_id: string;
  probe_status?: string;
  providers?: Array<{ id: string; name: string; is_current: boolean }>;
}

interface LocalHarnessState {
  id: string;
  installed: boolean;
  configExists: boolean;
}

/** Local discovery is not proof of provider credit, API entitlement, or reachability. */
export function deriveOnboardingStatus(roster: OnboardingAdapter[], local: LocalHarnessState[]) {
  const channels = roster.flatMap((adapter) => {
    const harness = local.find((entry) => entry.id === adapter.adapter_id);
    const localStatus = !harness?.installed ? 'NOT_INSTALLED'
      : !harness.configExists && adapter.adapter_id !== 'opencode' ? 'CONFIG_MISSING' : 'READY';
    const providers = adapter.providers?.length ? adapter.providers : [{ id: 'default', name: adapter.adapter_id, is_current: true }];
    return providers.map((provider) => ({
      adapter_id: adapter.adapter_id,
      provider_id: provider.id,
      provider_name: provider.name,
      active: provider.is_current,
      local_status: localStatus,
      availability: 'UNKNOWN' as const,
      quota: 'UNKNOWN' as const,
      api_access: 'UNKNOWN' as const,
    }));
  });
  return {
    zero_config: !roster.some((adapter) => adapter.probe_status === 'ONLINE'),
    free_adapter_id: 'opencode',
    local_ready: [...new Set(channels.filter((channel) => channel.active && channel.local_status === 'READY').map((channel) => channel.adapter_id))],
    channels,
  };
}
