export type ChannelOwnership = {
  assignmentKind?: string;
  internal?: {
    ownershipStatus?: string;
    customerId?: string | null;
    userId?: string | null;
    customerName?: string | null;
  };
};

export function channelOwnerLabel(value?: ChannelOwnership): string {
  const owner = value?.internal;
  if (owner?.ownershipStatus === 'restricted') return '已分配 · 无查看权限';
  if (owner?.ownershipStatus === 'scope_mismatch') return '归属范围待核实';
  if (owner?.ownershipStatus === 'unassigned') return '未绑定';
  if (owner?.customerName || owner?.customerId) return owner.customerName || owner.customerId!;
  // Compatible with older servers without claiming a missing lookup is unbound.
  if (value?.assignmentKind === 'project_wallet') return '已分配（项目钱包）';
  if (value?.assignmentKind === 'test_snapshot') return '已分配（测试快照）';
  if (value?.assignmentKind === 'unassigned') return '未绑定';
  return '归属未查询';
}
