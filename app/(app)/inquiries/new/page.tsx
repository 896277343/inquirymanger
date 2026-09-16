import { requireLeader } from "@/lib/auth";
import { InquiryForm } from "./inquiry-form";
export default async function NewInquiry(){await requireLeader();return <><div className="topline"><div><div className="title">AI录入询盘</div><p className="subtle">粘贴原文自动提取，确认无误后再保存</p></div></div><InquiryForm/></>}
