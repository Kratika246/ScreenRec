import './App.css';

export default function App() {
  return (
    <div className="landing-root">
      {/* Background decoration */}
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      {/* Header */}
      <header className="landing-header">
        <div className="landing-logo">
          <span className="logo-dot-l" />
          <span className="logo-name">ScreenRec</span>
        </div>
        <nav className="landing-nav">
          <a href="https://chrome.google.com/webstore" className="nav-link" target="_blank" rel="noreferrer">
            Get Extension
          </a>
        </nav>
      </header>

      {/* Hero */}
      <main className="landing-main">
        <section className="hero-section">
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            Free · No account needed to start
          </div>

          <h1 className="hero-title">
            Record your screen,
            <br />
            <span className="hero-gradient">share in seconds</span>
          </h1>

          <p className="hero-desc">
            A beautiful Chrome extension for screen recording with camera overlay.
            Press <kbd>Alt+Shift+R</kbd> to record and get a shareable link instantly.
          </p>

          <div className="hero-ctas">
            <a
              href="https://chrome.google.com/webstore"
              className="cta-primary"
              id="add-to-chrome-btn"
              target="_blank"
              rel="noreferrer"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="10" cy="10" r="4" fill="currentColor"/>
              </svg>
              Add to Chrome – it's free
            </a>
            <a href="#features" className="cta-secondary">
              Learn more ↓
            </a>
          </div>

          {/* Feature pills */}
          <div className="hero-pills">
            {['Screen recording', 'Camera overlay', 'Mic support', 'Instant share', 'Dark mode'].map((f) => (
              <span key={f} className="pill">{f}</span>
            ))}
          </div>
        </section>

        {/* Mock recording preview */}
        <section className="preview-section">
          <div className="preview-frame">
            <div className="preview-topbar">
              <div className="preview-dots">
                <span/><span/><span/>
              </div>
              <div className="preview-url">screenrec · recording</div>
              <div className="preview-controls">
                <div className="mini-rec-dot" />
                <span className="mini-timer">02:34</span>
                <button className="mini-stop">⏹</button>
              </div>
            </div>
            <div className="preview-body">
              <div className="preview-screen">
                <div className="preview-content">
                  <div className="preview-line wide" />
                  <div className="preview-line medium" />
                  <div className="preview-line narrow" />
                  <div className="preview-code">
                    <div className="code-line" style={{width:'70%'}} />
                    <div className="code-line" style={{width:'85%'}} />
                    <div className="code-line" style={{width:'60%'}} />
                    <div className="code-line" style={{width:'75%'}} />
                  </div>
                </div>
                <div className="cam-bubble-preview">
                  <div className="cam-face">👤</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="features-section">
          <h2 className="section-title">Everything you need</h2>
          <div className="features-grid">
            {[
              { icon: '🖥', title: 'Screen + Camera', desc: 'Record your screen with a floating camera bubble overlay. Drag, resize, and position it anywhere.' },
              { icon: '⚡', title: 'Instant upload', desc: 'Your recording uploads in the background as you record — no waiting when you stop.' },
              { icon: '🔗', title: 'One-click share', desc: 'Get a shareable link automatically copied to your clipboard the moment you stop recording.' },
              { icon: '⌨️', title: 'Keyboard shortcut', desc: 'Use Alt+Shift+R to start or stop recording without opening the extension popup.' },
              { icon: '⏸', title: 'Pause & resume', desc: 'Pause the recording at any time and resume where you left off — no extra clips.' },
              { icon: '🌙', title: 'Beautiful UI', desc: 'A premium dark interface that feels at home on any modern screen.' },
            ].map((f) => (
              <div key={f.title} className="feature-card">
                <div className="feature-icon">{f.icon}</div>
                <h3 className="feature-title">{f.title}</h3>
                <p className="feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="landing-footer">
        <p>© 2026 ScreenRec · Built for speed, built for teams</p>
      </footer>
    </div>
  );
}
