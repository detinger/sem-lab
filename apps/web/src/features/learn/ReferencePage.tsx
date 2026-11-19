import {
  registry,
  type Capability,
  type CapabilityStatus,
  type Verification,
} from '@sem-studio/method-registry';
import { Library, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Input,
  PageHeader,
  Tabs,
} from '@/components/ui';
import { allCitations, resolveCitations, useContent } from './content';
import { InlineText } from './inline';
import { plainInline } from './inline-parse';
import { ModelDiagram } from './ModelDiagram';
import type { GlossaryTerm, Theory } from './schema';
import './learn.css';

const norm = (s: string): string => s.toLowerCase();

export function matchesTerm(t: GlossaryTerm, q: string): boolean {
  const n = norm(q.trim());
  if (!n) return true;
  return [t.term, ...t.aliases, plainInline(t.definition)].some((x) => norm(x).includes(n));
}

const initialOf = (t: GlossaryTerm): string => {
  const c = t.term.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

function Glossary({ query, focus }: { query: string; focus: string | null }) {
  const glossary = useContent((c) => c.glossary);
  const lessons = useContent((c) => c.lessons);
  const shown = useMemo(() => glossary.filter((t) => matchesTerm(t, query)), [glossary, query]);
  const letters = [...new Set(shown.map(initialOf))].sort();
  const focused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    focused.current?.scrollIntoView?.({ block: 'center' });
  }, [focus, glossary.length]);
  if (glossary.length === 0)
    return (
      <EmptyState icon={<Library />} title="The glossary is not available yet">
        <p>Definitions will appear here as soon as the learning content is added to this build.</p>
      </EmptyState>
    );
  if (shown.length === 0)
    return (
      <EmptyState icon={<Search />} title="No matching terms">
        <p>Nothing in the glossary matches “{query}”. Try another word or an abbreviation.</p>
      </EmptyState>
    );
  return (
    <>
      <nav className="ref-az" aria-label="Jump to letter">
        {letters.map((l) => (
          <a key={l} href={`#letter-${l}`}>
            {l}
          </a>
        ))}
      </nav>
      <dl className="ref-glossary">
        {letters.map((l) => (
          <div key={l} role="group" aria-label={`Terms starting with ${l}`}>
            <h3 id={`letter-${l}`} className="ref-letter">
              {l}
            </h3>
            {shown
              .filter((t) => initialOf(t) === l)
              .map((t) => (
                <div
                  key={t.id}
                  id={`term-${t.id}`}
                  className={t.id === focus ? 'ref-term ref-term--focus' : 'ref-term'}
                  ref={(el) => {
                    if (t.id === focus) focused.current = el;
                  }}
                >
                  <dt>
                    {t.term}
                    {t.aliases.length > 0 ? (
                      <span className="ref-alias"> also: {t.aliases.join(', ')}</span>
                    ) : null}
                  </dt>
                  <dd>
                    <InlineText text={t.definition} />
                    {t.seeAlso.length > 0 ? (
                      <p className="ch-muted">
                        See also:{' '}
                        {t.seeAlso.map((id, i) => (
                          <span key={id}>
                            {i > 0 ? ', ' : ''}
                            <Link to={`/reference?term=${id}`}>
                              {glossary.find((g) => g.id === id)?.term ?? id}
                            </Link>
                          </span>
                        ))}
                      </p>
                    ) : null}
                    {t.lessons.length > 0 ? (
                      <p className="ch-muted">
                        Lessons:{' '}
                        {t.lessons.map((id, i) => (
                          <span key={id}>
                            {i > 0 ? ', ' : ''}
                            <Link to={`/learn/${id}`}>
                              {lessons.find((l2) => l2.id === id)?.title ?? id}
                            </Link>
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </dd>
                </div>
              ))}
          </div>
        ))}
      </dl>
    </>
  );
}

function TheoryCard({ theory }: { theory: Theory }) {
  const citations = useContent((c) => c.citations);
  const refs = resolveCitations(theory.references, citations);
  return (
    <Card className="ref-theory" role="group" aria-label={theory.name}>
      <CardHeader
        title={theory.name}
        level={3}
        action={<Badge variant="neutral">{theory.field}</Badge>}
      />
      <p>
        <InlineText text={theory.summary} />
      </p>
      {theory.model ? (
        <ModelDiagram model={theory.model} caption={`${theory.name}: canonical model`} />
      ) : null}
      <h4>Constructs</h4>
      <ul className="ref-list">
        {theory.constructs.map((c) => (
          <li key={c.name}>
            <strong>
              {c.name} ({c.abbreviation})
            </strong>
            : <InlineText text={c.definition} />
          </li>
        ))}
      </ul>
      <h4>Relationships</h4>
      <ul className="ref-list">
        {theory.relationships.map((r) => (
          <li key={r}>
            <InlineText text={r} />
          </li>
        ))}
      </ul>
      {theory.examples.length > 0 || theory.notebooks.length > 0 ? (
        <p className="ch-muted">
          {theory.examples.length > 0 ? (
            <>
              Examples: <Link to="/examples">{theory.examples.join(', ')}</Link>.{' '}
            </>
          ) : null}
          {theory.notebooks.length > 0 ? <>Notebooks: {theory.notebooks.join(', ')}.</> : null}
        </p>
      ) : null}
      {theory.caveats ? (
        <Callout variant="warning" title="Caveats">
          <InlineText text={theory.caveats} />
        </Callout>
      ) : null}
      <h4>References</h4>
      <ul className="ref-list">
        {refs.map((r) => (
          <li key={r.key}>{r.text}</li>
        ))}
      </ul>
    </Card>
  );
}

function Theories({ query }: { query: string }) {
  const theories = useContent((c) => c.theories);
  const shown = theories.filter((t) => {
    const n = norm(query.trim());
    return (
      !n ||
      [
        t.name,
        t.field,
        plainInline(t.summary),
        ...t.constructs.flatMap((c) => [c.name, c.abbreviation]),
      ].some((x) => norm(x).includes(n))
    );
  });
  if (theories.length === 0)
    return (
      <EmptyState icon={<Library />} title="The theory encyclopedia is not available yet">
        <p>Theories will appear here as soon as the learning content is added to this build.</p>
      </EmptyState>
    );
  if (shown.length === 0)
    return (
      <EmptyState icon={<Search />} title="No matching theories">
        <p>Nothing matches “{query}”.</p>
      </EmptyState>
    );
  return (
    <div className="ref-stack">
      {shown.map((t) => (
        <TheoryCard key={t.id} theory={t} />
      ))}
    </div>
  );
}

const STATUS: Record<
  CapabilityStatus,
  { label: string; variant: 'success' | 'info' | 'warning' | 'neutral' }
> = {
  supported: { label: 'Supported', variant: 'success' },
  beta: { label: 'Beta', variant: 'info' },
  planned: { label: 'Planned: not available yet', variant: 'warning' },
  unsupported: { label: 'Not supported', variant: 'neutral' },
};
const VERIFICATION: Record<Verification, string> = {
  'reference-tested': 'Reference-tested against R',
  'engine-verified': 'Verified by engine tests',
  'smoke-only': 'Smoke-tested only',
  none: 'Not verified',
};
const FAMILY: Record<string, string> = {
  'pls-sem': 'PLS-SEM',
  'cb-sem': 'CB-SEM',
  resampling: 'Resampling',
  assessment: 'Assessment',
  effects: 'Effects',
  prediction: 'Prediction',
  ipma: 'IPMA',
  groups: 'Groups',
  data: 'Data',
  export: 'Export',
};

export function MethodCards({ query, availableOnly }: { query: string; availableOnly: boolean }) {
  const items = registry.capabilities
    .map((c) => ({ c, e: c.engines.browser }))
    .filter((x): x is { c: Capability; e: NonNullable<typeof x.e> } => x.e !== undefined)
    .filter(({ e }) => !availableOnly || e.status === 'supported' || e.status === 'beta')
    .filter(({ c }) => {
      const n = norm(query.trim());
      return (
        !n ||
        [c.title, c.description, c.id, FAMILY[c.family] ?? ''].some((x) => norm(x).includes(n))
      );
    });
  const families = [...new Set(items.map((x) => x.c.family))];
  if (items.length === 0)
    return (
      <EmptyState icon={<Search />} title="No matching methods">
        <p>Nothing matches. Try clearing the search or showing planned methods too.</p>
      </EmptyState>
    );
  return (
    <>
      {families.map((fam) => (
        <section key={fam} aria-labelledby={`fam-${fam}`} className="ref-family">
          <h3 id={`fam-${fam}`}>{FAMILY[fam] ?? fam}</h3>
          <div className="ref-grid">
            {items
              .filter((x) => x.c.family === fam)
              .map(({ c, e }) => {
                const st = STATUS[e.status];
                const refs = resolveCitations(c.references, []);
                const available = e.status === 'supported' || e.status === 'beta';
                return (
                  <Card key={c.id} className="ref-method" role="group" aria-label={c.title}>
                    <div className="ref-method__chips">
                      <Badge variant={st.variant}>{st.label}</Badge>
                      {available ? (
                        <Badge variant="neutral">{VERIFICATION[e.verification]}</Badge>
                      ) : null}
                    </div>
                    <h4>{c.title}</h4>
                    <p>{c.description}</p>
                    {e.notes && available ? <p className="ch-muted">{e.notes}</p> : null}
                    {!available && e.reason ? <p className="ch-muted">{e.reason}</p> : null}
                    {refs.length > 0 ? (
                      <p className="ch-muted">
                        References:{' '}
                        {refs.map((r) => r.text.split('(')[0]?.trim() || r.key).join('; ')}
                      </p>
                    ) : null}
                  </Card>
                );
              })}
          </div>
        </section>
      ))}
    </>
  );
}

function Methods({ query }: { query: string }) {
  const [availableOnly, setAvailableOnly] = useState(true);
  return (
    <>
      <p className="ch-muted">
        Generated from the method registry for the engine that runs in this browser. A method that
        is planned or unsupported is never offered in the app.
      </p>
      <div className="ref-filters" role="group" aria-label="Method filter">
        <Chip selected={availableOnly} onClick={() => setAvailableOnly((v) => !v)}>
          Available now only
        </Chip>
      </div>
      <MethodCards query={query} availableOnly={availableOnly} />
    </>
  );
}

function Citations({ query }: { query: string }) {
  const extra = useContent((c) => c.citations);
  const all = allCitations(extra).filter(
    (c) => !query.trim() || norm(c.text).includes(norm(query.trim())),
  );
  if (all.length === 0)
    return (
      <EmptyState icon={<Search />} title="No matching references">
        <p>Nothing matches “{query}”.</p>
      </EmptyState>
    );
  return (
    <ul className="ref-citations">
      {all.map((c) => (
        <li key={c.key} id={`cite-${c.key}`}>
          {c.text}
          {c.doi ? (
            <>
              {' '}
              <a href={`https://doi.org/${c.doi}`} target="_blank" rel="noreferrer">
                doi:{c.doi}
              </a>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

type TabId = 'glossary' | 'theories' | 'methods' | 'citations';

export function ReferencePage() {
  const [params, setParams] = useSearchParams();
  const term = params.get('term');
  const [tab, setTab] = useState<TabId>('glossary');
  const [query, setQuery] = useState('');
  return (
    <>
      <PageHeader
        eyebrow="Utilities"
        title="Reference"
        description="A glossary, the theories behind the examples, what each method in this browser engine can do, and the references."
      />
      <div className="ref-search">
        <label htmlFor="ref-search" className="sr-only">
          Search the reference
        </label>
        <Search size={16} aria-hidden="true" className="ref-search__icon" />
        <Input
          id="ref-search"
          type="search"
          placeholder="Search terms, aliases, theories, methods"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (term) setParams({}, { replace: true });
          }}
        />
      </div>
      <Tabs
        aria-label="Reference sections"
        value={term && tab === 'glossary' ? 'glossary' : tab}
        onValueChange={(v) => setTab(v as TabId)}
        items={[
          { id: 'glossary', label: 'Glossary', content: <Glossary query={query} focus={term} /> },
          { id: 'theories', label: 'Theories', content: <Theories query={query} /> },
          { id: 'methods', label: 'Methods', content: <Methods query={query} /> },
          { id: 'citations', label: 'References', content: <Citations query={query} /> },
        ]}
      />
    </>
  );
}
