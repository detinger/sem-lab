import { Callout } from '@/components/ui';
import { Demo } from './DemoBlock';
import { InlineText } from './inline';
import { ModelDiagram } from './ModelDiagram';
import type { Block } from './schema';

const CALLOUT = { info: 'info', warning: 'warning', tip: 'recommendation' } as const;

export function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'p':
      return (
        <p>
          <InlineText text={block.text} />
        </p>
      );
    case 'callout':
      return (
        <Callout variant={CALLOUT[block.variant]} {...(block.title ? { title: block.title } : {})}>
          <InlineText text={block.text} />
        </Callout>
      );
    case 'formula':
      return (
        <figure className="learn-formula">
          <code className="learn-formula__display">{block.display}</code>
          <figcaption>
            <InlineText text={block.explanation} />
          </figcaption>
        </figure>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineText text={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'diagram':
      return (
        <ModelDiagram model={block.model} caption={block.caption} highlight={block.highlight} />
      );
    case 'demo':
      return (
        <div className="learn-demo">
          <Demo id={block.demo} initial={block.initial} />
          {block.caption ? <p className="learn-demo__caption">{block.caption}</p> : null}
        </div>
      );
  }
}

export function Blocks({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div className="learn-blocks">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}
