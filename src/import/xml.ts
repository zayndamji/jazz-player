/** A small XML reader: elements, attributes, text and entities. Enough for MusicXML; no DOM needed. */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text directly inside the element, trimmed. */
  text: string;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

export function parseXml(source: string): XmlNode {
  const s = source.replace(/^﻿/, "");
  let i = 0;
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const fail = (msg: string): never => {
    throw new Error(`The file is not valid XML (${msg}).`);
  };
  const skipTo = (end: string, what: string) => {
    const at = s.indexOf(end, i);
    if (at < 0) fail(`unterminated ${what}`);
    i = at + end.length;
  };
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      top.text += decodeEntities(s.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(s.slice(i, lt));
    i = lt;
    if (s.startsWith("<!--", i)) skipTo("-->", "comment");
    else if (s.startsWith("<![CDATA[", i)) {
      const at = s.indexOf("]]>", i);
      if (at < 0) fail("unterminated CDATA");
      top.text += s.slice(i + 9, at);
      i = at + 3;
    } else if (s.startsWith("<?", i)) skipTo("?>", "declaration");
    else if (s.startsWith("<!", i)) {
      // DOCTYPE, possibly with an internal subset in brackets.
      let depth = 0;
      while (i < s.length) {
        const c = s[i++];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
    } else if (s.startsWith("</", i)) {
      const end = s.indexOf(">", i);
      if (end < 0) fail("unterminated tag");
      const name = s.slice(i + 2, end).trim();
      if (stack.length < 2 || stack[stack.length - 1].name !== name) fail(`unexpected </${name}>`);
      stack.pop();
      i = end + 1;
    } else {
      const m = /^<([^\s/>]+)/.exec(s.slice(i, i + 200));
      if (!m) fail("bad tag");
      const node: XmlNode = { name: m![1], attrs: {}, children: [], text: "" };
      i += m![0].length;
      const attr = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
      for (;;) {
        attr.lastIndex = i;
        const a = attr.exec(s);
        if (!a) break;
        node.attrs[a[1]] = decodeEntities(a[3] ?? a[4]);
        i = attr.lastIndex;
      }
      while (i < s.length && /\s/.test(s[i])) i++;
      top.children.push(node);
      if (s.startsWith("/>", i)) i += 2;
      else if (s[i] === ">") {
        i++;
        stack.push(node);
      } else fail(`bad tag <${node.name}>`);
    }
  }
  if (stack.length > 1) fail(`<${stack[stack.length - 1].name}> is not closed`);
  const element = root.children[0];
  if (!element) fail("no content");
  trimText(element);
  return element;
}

function trimText(node: XmlNode) {
  node.text = node.text.trim();
  node.children.forEach(trimText);
}

export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => node?.children.find((c) => c.name === name);
export const childrenOf = (node: XmlNode | undefined, name: string): XmlNode[] => node?.children.filter((c) => c.name === name) ?? [];
export const textOf = (node: XmlNode | undefined, name: string): string | undefined => child(node, name)?.text;
