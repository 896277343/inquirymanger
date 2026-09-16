type Json=Record<string,any>;
function apiUrl(base:string,path:string){const clean=base.trim().replace(/\/+$/,"");return `${clean.toLowerCase().endsWith("index.php")?clean:`${clean}/index.php`}/${path}`}
async function post(base:string,path:string,data:Record<string,string>,headers:Record<string,string>={}){
  const response=await fetch(apiUrl(base,path),{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",...headers},body:new URLSearchParams(data),signal:AbortSignal.timeout(30000)});
  const json=await response.json().catch(()=>null) as Json|null;
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  if(!json||json.code!==200)throw new Error(json?.error||"悟空CRM返回格式异常");
  return json.data;
}
export async function syncToWukong(config:{base:string;username:string;password:string;customerId?:number|null;name:string;contactName:string;email:string;phone:string;country:string;source:string;product:string;requirement:string;inquiryNo:string}){
  const login=await post(config.base,"admin/base/login",{username:config.username,password:config.password});
  const auth={authKey:String(login.authKey),sessionId:String(login.sessionId)};
  let customerId=config.customerId||null;
  if(!customerId){const source:Record<string,string>={GOOGLE_ADS:"广告",ORGANIC:"搜索引擎",LIVE_CHAT:"线上询价"};const remark=`询盘编号：${config.inquiryNo}\n客户邮箱：${config.email}\n国家：${config.country}\n产品：${config.product}\n需求：${config.requirement}`;const created=await post(config.base,"crm/customer/save",{name:config.name,telephone:config.phone,source:source[config.source]||"线上询价",deal_status:"未成交",remark},auth);customerId=Number(created.customer_id)}
  try{await post(config.base,"crm/contacts/save",{name:config.contactName||config.email,customer_id:String(customerId),email:config.email,mobile:config.phone,telephone:config.phone,remark:`来源：${config.inquiryNo}`},auth)}catch(error){(error as any).customerId=customerId;throw error}
  return {customerId};
}
