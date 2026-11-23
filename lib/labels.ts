export const sources: Record<string, string> = { GOOGLE_ADS: "谷歌广告", ORGANIC: "自然流量", LIVE_CHAT: "在线聊天留言" };
export const statuses: Record<string, string> = {
  UNASSIGNED: "待分配", NEW: "待接受", ACCEPTED: "已接受待首封邮件", CONTACTING: "第一次沟通",
  SECOND_CONTACT: "第二次沟通", THIRD_CONTACT: "第三次沟通", ONGOING: "持续沟通中",
  WON: "已成交", NO_REPLY: "三次沟通无回复（公海）", PUBLIC_POOL: "公海",
  TECHNICAL: "技术沟通（历史）", QUOTED: "已报价（历史）",
  NEGOTIATING: "商务谈判（历史）", WAITING: "等待客户（历史）",
  PAUSED: "暂停跟进（历史）", LOST: "已丢单（历史）"
};
export const products = ["中大型SF6回收车", "小型SF6回收车", "SF6分析仪", "仪表类", "充气管跟接头", "非自营产品", "氢气产品", "其他"];
