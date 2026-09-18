export const sources: Record<string, string> = { GOOGLE_ADS: "谷歌广告", ORGANIC: "自然流量", LIVE_CHAT: "在线聊天留言" };
export const statuses: Record<string, string> = {
  UNASSIGNED: "待分配", NEW: "待首次跟进", CONTACTING: "需求确认", TECHNICAL: "技术沟通",
  QUOTED: "已报价", NEGOTIATING: "商务谈判", WAITING: "等待客户", WON: "已成交",
  PAUSED: "暂停跟进", LOST: "已丢单", PUBLIC_POOL: "公海"
};
export const salesProgressStatuses: Record<string, string> = {
  CONTACTING: "需求确认",
  TECHNICAL: "技术沟通",
  QUOTED: "已报价",
  NEGOTIATING: "商务谈判",
  WON: "已成交"
};
export const progressReminderDays: Record<string, number | null> = {
  CONTACTING: 3,
  TECHNICAL: 3,
  QUOTED: 3,
  NEGOTIATING: 4,
  WON: null
};
export const products = ["中大型SF6回收车", "小型SF6回收车", "SF6分析仪", "仪表类", "充气管跟接头", "非自营产品", "氢气产品", "其他"];
