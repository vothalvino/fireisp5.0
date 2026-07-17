// =============================================================================
// FireISP 5.0 — MarkdownView
// =============================================================================
// Shared markdown renderer: GFM (tables, strikethrough, task lists) + heading
// anchors so in-document tables of contents work. react-markdown never emits
// raw HTML from the source (it renders it as text), so this adds no
// sanitization sink — PortalKb.tsx remains the app's only
// dangerouslySetInnerHTML user (see the security-posture note there).
//
// Consumers should lazy-import this module (React.lazy) so the renderer only
// ships to pages that actually display markdown.
// =============================================================================

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import './markdown.css';

export function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="fi-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownView;
