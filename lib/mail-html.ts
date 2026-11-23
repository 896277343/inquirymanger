import sanitizeHtml from "sanitize-html";

export function cleanMailHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ["p", "div", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "blockquote"],
    allowedAttributes: {},
    disallowedTagsMode: "discard"
  });
}
