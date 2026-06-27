export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#111111] text-[#f0f0f0]" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#111111]/95 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="/" className="text-lg text-white tracking-wide font-semibold">hiyori</a>
          <a href="/" className="text-sm text-white/40 hover:text-white/70 transition-colors">← Back</a>
        </div>
      </nav>

      <main className="pt-28 pb-24 px-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs text-white/30 mb-4 tracking-widest uppercase">Legal</p>
          <h1 className="text-4xl font-bold text-white mb-2">Privacy Policy</h1>
          <p className="text-white/40 text-sm mb-12">Last updated: June 2025</p>

          <div className="space-y-10 text-white/70 leading-relaxed text-sm">
            <section>
              <h2 className="text-white text-base font-semibold mb-3">1. What We Collect</h2>
              <p>When you interact with Hiyori on Discord, we collect and store:</p>
              <ul className="mt-3 space-y-1.5 list-disc list-inside text-white/60">
                <li>Your Discord user ID (not your username or email)</li>
                <li>Messages you send to Hiyori (for AI context and memory features)</li>
                <li>Your gem and gold balances, gacha collection, and economy activity</li>
                <li>Voting activity (if you vote on top.gg)</li>
                <li>Server IDs and channel IDs where Hiyori is active</li>
                <li>If you log in to the dashboard via Discord OAuth: your Discord username, display name, and avatar URL</li>
              </ul>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">2. How We Use Your Data</h2>
              <ul className="mt-3 space-y-1.5 list-disc list-inside text-white/60">
                <li>To provide AI conversation features (Hiyori's responses and memory)</li>
                <li>To manage your gem/gold economy balance and gacha collection</li>
                <li>To track voting bonuses and daily rewards</li>
                <li>To enable per-server configuration via the dashboard</li>
                <li>We do not sell your data to third parties</li>
                <li>We do not use your data for advertising</li>
              </ul>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">3. AI Processing</h2>
              <p>Hiyori uses third-party AI providers (Google Gemini, Groq) to generate responses. Messages sent to Hiyori may be transmitted to these providers for processing. Please review their privacy policies:</p>
              <ul className="mt-3 space-y-1.5 list-disc list-inside text-white/60">
                <li><a href="https://policies.google.com/privacy" className="text-purple-400 hover:text-purple-300">Google Privacy Policy</a></li>
                <li><a href="https://groq.com/privacy-policy/" className="text-purple-400 hover:text-purple-300">Groq Privacy Policy</a></li>
              </ul>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">4. Data Retention</h2>
              <p>Your data is stored for as long as you actively use Hiyori. Conversation context is kept for AI memory purposes. You can request deletion of your data at any time by contacting us (see Section 7). Economy data (gems, gold, collection) is retained as it represents your in-app progress.</p>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">5. Data Security</h2>
              <p>We store data in a PostgreSQL database with standard security practices. No passwords or payment credentials are stored (OAuth only; payments processed by third-party providers). We use HTTPS for all communications.</p>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">6. Children's Privacy</h2>
              <p>Hiyori is not directed at children under 13. If you are under 13, please do not use this service. Discord itself requires users to be at least 13 years old.</p>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">7. Your Rights</h2>
              <p>You may request access to, correction of, or deletion of your personal data at any time. To exercise these rights, contact us via the support server linked in Hiyori's profile on Discord or top.gg.</p>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">8. Changes to This Policy</h2>
              <p>We may update this policy from time to time. Continued use of Hiyori after changes constitutes acceptance of the updated policy. Major changes will be announced in our support server.</p>
            </section>
          </div>
        </div>
      </main>

      <footer className="border-t border-white/[0.06] py-8 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between text-xs text-white/20">
          <span>hiyori — a discord bot</span>
          <div className="flex gap-4">
            <a href="/privacy" className="hover:text-white/40 transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-white/40 transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
