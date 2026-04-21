import { Logo } from './Logo';

const SAMPLE_QUESTIONS = [
  'What do I owe for the group trip?',
  'What’s for dinner tonight?',
  'When did we last see the Garcias?',
  'Did I already buy Mom’s gift?',
];

export function AskSection() {
  return (
    <section className="hh-section" style={{ padding: '100px 56px' }}>
      <div
        className="hh-ask-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.1fr',
          gap: 64,
          alignItems: 'center',
        }}
      >
        <div>
          <div
            className="text-sub font-mono"
            style={{ fontSize: 11, letterSpacing: 1, marginBottom: 8 }}
          >
            {'// ASK IN PLAIN ENGLISH'}
          </div>
          <div
            style={{
              fontSize: 42,
              fontWeight: 600,
              letterSpacing: '-1.4px',
              marginBottom: 20,
              textWrap: 'balance',
            }}
          >
            Can&apos;t remember? Just ask.
          </div>
          <p className="text-sub" style={{ fontSize: 17, lineHeight: 1.6, marginBottom: 20 }}>
            If a thought starts with &ldquo;wait, when was…&rdquo; or &ldquo;did we already…&rdquo;
            — HomeHub can probably answer it. Type or tap. No perfect wording required.
          </p>
          <div className="flex" style={{ flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
            {SAMPLE_QUESTIONS.map((q) => (
              <span
                key={q}
                style={{
                  padding: '7px 13px',
                  background: 'var(--color-warm-sand)',
                  border: '1px solid var(--color-rule)',
                  borderRadius: 20,
                  fontSize: 13,
                }}
              >
                {q}
              </span>
            ))}
          </div>
        </div>

        <div
          className="bg-card"
          style={{
            border: '1px solid var(--color-rule)',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 20px 60px -20px rgba(0, 0, 0, 0.15)',
          }}
        >
          <div
            className="flex items-center"
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--color-rule)',
              background: 'var(--color-warm-sand)',
              fontSize: 13,
              fontWeight: 500,
              gap: 8,
            }}
          >
            <Logo size={14} /> Ask HomeHub
          </div>
          <div className="flex flex-col" style={{ padding: 22, gap: 14 }}>
            <div
              className="bg-ink text-bg"
              style={{
                alignSelf: 'flex-end',
                maxWidth: '82%',
                padding: '11px 15px',
                borderRadius: 16,
                borderBottomRightRadius: 4,
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              Did I already get Mom something for her birthday?
            </div>
            <div
              style={{
                maxWidth: '90%',
                padding: '12px 15px',
                background: 'var(--color-warm-sand)',
                borderRadius: 16,
                borderBottomLeftRadius: 4,
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              Not yet — her birthday is next Tuesday. Last year you gave her a gardening book and a
              blue scarf, and she loved both. Want me to suggest a few ideas in the same spirit?
            </div>
            <div
              className="bg-ink text-bg"
              style={{
                alignSelf: 'flex-end',
                maxWidth: '82%',
                padding: '11px 15px',
                borderRadius: 16,
                borderBottomRightRadius: 4,
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              Yes please.
            </div>
            <div
              style={{
                maxWidth: '90%',
                padding: '12px 15px',
                background: 'var(--color-warm-sand)',
                borderRadius: 16,
                borderBottomLeftRadius: 4,
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              A Saturday pottery class nearby, a heated garden kneeler, or a hardcover of the Olive
              Kitteridge books. I can draft a note to her too, when you&apos;re ready.
            </div>
          </div>
          <div
            className="flex items-center"
            style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--color-rule)',
              gap: 10,
            }}
          >
            <div
              className="text-sub"
              style={{
                flex: 1,
                padding: '9px 14px',
                border: '1px solid var(--color-rule)',
                borderRadius: 20,
                fontSize: 13.5,
              }}
            >
              Ask about your household…
            </div>
            <span
              className="bg-accent"
              style={{
                padding: '7px 12px',
                color: '#fff',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              ↑
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
