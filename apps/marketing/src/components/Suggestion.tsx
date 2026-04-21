export function Suggestion() {
  const peopleColor = 'var(--color-area-people)';
  return (
    <section
      className="hh-section hh-suggestion border-rule border-t border-b"
      style={{
        padding: '100px 56px',
        background: 'var(--color-warm-sand)',
      }}
    >
      <div
        className="hh-suggestion-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.1fr 1fr',
          gap: 64,
          alignItems: 'center',
        }}
      >
        <div
          className="bg-card"
          style={{
            border: '1px solid var(--color-rule)',
            borderRadius: 8,
            padding: 24,
            boxShadow: '0 10px 30px -10px rgba(0, 0, 0, 0.1)',
          }}
        >
          <div
            className="font-mono flex items-center"
            style={{
              fontSize: 10,
              color: peopleColor,
              letterSpacing: 0.5,
              marginBottom: 10,
              gap: 6,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: peopleColor,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            SUNDAY SUGGESTION · PEOPLE
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: '-0.3px',
              marginBottom: 8,
            }}
          >
            Invite the Garcias for dinner?
          </div>
          <div className="text-sub" style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>
            They last hosted you in November. You&apos;re both free Saturday May 17 and they like
            the pasta you made for Tala.
          </div>
          <div
            className="text-sub"
            style={{
              padding: '10px 12px',
              background: 'var(--color-warm-sand)',
              borderRadius: 4,
              fontSize: 12.5,
              lineHeight: 1.5,
              marginBottom: 16,
              fontStyle: 'italic',
            }}
          >
            &ldquo;Hey Maria — would you and Luis want to come by Saturday the 17th? I&apos;ll make
            that pasta you liked. — E&rdquo;
          </div>
          <div className="flex" style={{ gap: 8 }}>
            <span
              className="bg-ink text-bg"
              style={{
                padding: '7px 14px',
                fontSize: 13,
                borderRadius: 3,
                fontWeight: 500,
              }}
            >
              Send it
            </span>
            <span
              style={{
                padding: '7px 14px',
                fontSize: 13,
                border: '1px solid var(--color-rule)',
                borderRadius: 3,
              }}
            >
              Edit first
            </span>
            <span className="text-sub" style={{ padding: '7px 14px', fontSize: 13 }}>
              Not now
            </span>
          </div>
        </div>
        <div>
          <div
            className="text-sub font-mono"
            style={{ fontSize: 11, letterSpacing: 1, marginBottom: 8 }}
          >
            {'// IT SUGGESTS · YOU DECIDE'}
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
            Helpful. Never bossy.
          </div>
          <p className="text-sub" style={{ fontSize: 17, lineHeight: 1.6, marginBottom: 16 }}>
            HomeHub offers little nudges — a dinner to cook, a friend to catch up with, a bill to
            review. You decide what to do with them. Nothing happens without your say-so.
          </p>
          <p className="text-sub" style={{ fontSize: 17, lineHeight: 1.6 }}>
            No streaks. No guilt. No pings at 11pm. Just a short, quiet check-in when you want one.
          </p>
        </div>
      </div>
    </section>
  );
}
