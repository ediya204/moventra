// Retirement boundaries do not change customer IDs, membership ownership or ledger history.
export const TEAM_UNAVAILABLE = "V1 暂不支持团队协作，请使用个人账户业务。";
export function assertPersonalAction(action: unknown) {
  const a=action as Record<string,unknown> | null;
  if (a && (["team","invite","finance/transfer"].includes(String(a.type)) || a.source === "team" || Object.hasOwn(a,"team")))
    throw Object.assign(new Error(TEAM_UNAVAILABLE),{status:410});
}
export function retiredTeamPath(path:string):string | null {
  const p=path.toLowerCase().replace(/\/+$/,"");
  const resource="(?:teams?|members|invitations?|invites?|team-members|team-invitations)";
  if (new RegExp(`^/portal/(?:settings/|account/)?${resource}(?:/|$)`).test(p) || /^\/portal\/funds\/transfer(?:\/|$)/.test(p)) return "/portal/overview";
  if (new RegExp(`^/(?:customers/[^/]+/)?${resource}(?:/|$)`).test(p)) return "/workbench";
  return null;
}
export function isRetiredNotice(n:{title?:string;text:string}) {
  return /成员邀请|邀请成员|团队邀请|邀请加入|子账户已创建/.test(`${n.title||""} ${n.text}`);
}
