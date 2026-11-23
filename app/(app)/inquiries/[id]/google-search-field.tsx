"use client";

import { useState } from "react";

export function GoogleSearchField({ name, label, initialValue }: {
  name: "name" | "company"; label: string; initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const id = `customer-${name}`;
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="field-search-line">
      <input id={id} name={name} value={value} onChange={event => setValue(event.target.value)}/>
      <button type="button" className="btn btn-small" disabled={!value.trim()} onClick={() => {
        const query = value.trim();
        if (query) window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
      }}>谷歌搜索</button>
    </div>
  </div>;
}
