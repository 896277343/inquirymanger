"use server";
import { revalidatePath } from "next/cache";
import { requireLeader } from "@/lib/auth";
import { audit, db } from "@/lib/db";
import { encryptSecret } from "@/lib/secrets";

function save(key:string,value:string){db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key,value)}

export async function saveAiSettings(formData:FormData){
  const s=await requireLeader();
  const protocol=String(formData.get("protocol"));
  const endpoint=String(formData.get("endpoint")||"").trim();
  const model=String(formData.get("model")||"").trim();
  const apiKey=String(formData.get("apiKey")||"").trim();
  if(!["RESPONSES","CHAT_COMPLETIONS"].includes(protocol)) throw new Error("协议类型不正确");
  if(!/^https?:\/\//i.test(endpoint)) throw new Error("请求地址必须以 http:// 或 https:// 开头");
  if(!model) throw new Error("请填写模型名称");
  save("ai_protocol",protocol);save("ai_endpoint",endpoint);save("ai_model",model);
  if(apiKey) save("ai_api_key",encryptSecret(apiKey));
  audit(s.id,"UPDATE","SETTINGS",null,"更新AI接口配置",{protocol,endpoint,model,apiKeyChanged:Boolean(apiKey)});
  revalidatePath("/settings/ai");
}
