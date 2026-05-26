'use client';

// DingTalk image messages either embed a public picURL or carry a mediaId.
// We can't proxy mediaIds without an additional `dws drive download` step
// (TODO), so for now we render any direct http(s) image URL inline and pass
// other content through as plain text. The chatroomId param is kept on the
// signature for future use.
const URL_RE_SOURCE = /(https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s)]*)?)/gi.source;

export default function MessageContent({
  content,
}: {
  content: string;
  chatroomId?: string;
}) {
  if (!content) return null;

  // Fresh regex per call so lastIndex isn't shared across renders.
  const re = new RegExp(URL_RE_SOURCE, 'gi');
  if (!re.test(content)) {
    return <span className="whitespace-pre-wrap break-words">{content}</span>;
  }

  const parts: Array<{ type: 'text'; v: string } | { type: 'img'; url: string }> = [];
  let last = 0;
  for (const m of content.matchAll(new RegExp(URL_RE_SOURCE, 'gi'))) {
    if (m.index === undefined) continue;
    if (m.index > last) parts.push({ type: 'text', v: content.slice(last, m.index) });
    parts.push({ type: 'img', url: m[1] });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ type: 'text', v: content.slice(last) });

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        if (p.type === 'text') return <span key={i}>{p.v}</span>;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={p.url}
            alt="图片"
            loading="lazy"
            referrerPolicy="no-referrer"
            className="my-1 inline-block max-h-[280px] max-w-full rounded border border-[var(--border)] align-middle"
            onError={(e) => {
              const el = e.currentTarget;
              el.replaceWith(
                Object.assign(document.createElement('a'), {
                  className: 'text-[var(--text-3)] underline',
                  href: p.url,
                  target: '_blank',
                  rel: 'noopener',
                  textContent: '[图片缺失]',
                }) as HTMLElement,
              );
            }}
          />
        );
      })}
    </span>
  );
}
