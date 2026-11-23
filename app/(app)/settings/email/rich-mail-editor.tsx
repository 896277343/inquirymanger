"use client";

import { useRef, useState } from "react";

export function RichMailEditor({ initialHtml = "", initialText = "" }:
  { initialHtml?: string; initialText?: string }) {
  const editor = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(initialHtml);
  const [text, setText] = useState(initialText);
  function sync() {
    setHtml(editor.current?.innerHTML || "");
    setText(editor.current?.innerText || "");
  }
  function format(command: string) {
    editor.current?.focus();
    document.execCommand(command, false);
    sync();
  }
  return <div className="field">
    <strong>邮件正文</strong>
    <p className="subtle">可从原邮件复制并粘贴排版；也可在下方分段编辑。支持粗体、斜体和列表，发送前请核对预览。</p>
    <div className="actions" style={{marginBottom:8}}>
      <button type="button" className="btn" onMouseDown={event=>event.preventDefault()} onClick={()=>format("bold")}>粗体</button>
      <button type="button" className="btn" onMouseDown={event=>event.preventDefault()} onClick={()=>format("italic")}>斜体</button>
      <button type="button" className="btn" onMouseDown={event=>event.preventDefault()} onClick={()=>format("insertUnorderedList")}>项目列表</button>
      <button type="button" className="btn" onMouseDown={event=>event.preventDefault()} onClick={()=>format("insertOrderedList")}>编号列表</button>
    </div>
    <div ref={editor} contentEditable suppressContentEditableWarning role="textbox" aria-label="邮件正文" aria-multiline="true"
      onInput={sync} onBlur={sync} dangerouslySetInnerHTML={{__html:initialHtml}}
      style={{minHeight:220,padding:14,border:"1px solid #cbd5e1",borderRadius:8,background:"white",lineHeight:1.6,whiteSpace:"pre-wrap"}}/>
    <input type="hidden" name="body" value={text}/>
    <input type="hidden" name="bodyHtml" value={html}/>
  </div>;
}
