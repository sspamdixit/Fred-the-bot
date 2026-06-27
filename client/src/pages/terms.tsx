export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-[#111111] text-[#f0f0f0]" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#111111]/95 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="/" className="text-lg text-white tracking-wide font-semibold">kira</a>
          <a href="/" className="text-sm text-white/40 hover:text-white/70 transition-colors">← Back</a>
        </div>
      </nav>

      <main className="pt-28 pb-24 px-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs text-white/30 mb-4 tracking-widest uppercase">Legal</p>
          <h1 className="text-4xl font-bold text-white mb-2">Terms of Service</h1>
          <p className="text-white/40 text-sm mb-12">Last updated: June 2025</p>

          <div className="space-y-10 text-white/70 leading-relaxed text-sm">
            <section>
              <h2 className="text-white text-base font-semibold mb-3">1. Acceptance of Terms</h2>
              <p>By adding Kira to your Discord server or interacting with Kira in any way, you agree to these Terms of Service. If you do not agree, please remove Kira from your server and discontinue use.</p>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">2. Description of Service</h2>
              <p>Kira is an AI-powered Discord bot that provides conversational AI features, a virtual economy (gems and gold), and a gacha (character collection) system. Features include:</p>
              <ul className="mt-3 space-y-1.5 list-disc list-inside text-white/60">
                <li>AI conversations powered by Google Gemini and Groq</li>
                <li>A virtual gem and gold economy for accessing features</li>
                <li>A gacha system for collecting anime-style characters (sourced from AniList)</li>
                <li>Daily rewards, voting bonuses, and in-app progression</li>
                <li>A web dashboard for server administrators</li>
              </ul>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">3. Virtual Currency and Economy</h2>
              <p className="mb-3">Kira uses two virtual currencies: <strong className="text-white">Gems (💎)</strong> and <strong className="text-white">Gold (🪙)</strong>.</p>
              <ul className="space-y-1.5 list-disc list-inside text-white/60">
                <li>Gems are used to send messages to Kira. Free gems are earned via daily rewards and voting.</li>
                <li>Gold is used for gacha pulls and other features. Gold is earned via daily rewards.</li>
                <li>Virtual currencies have no real-world monetary value and cannot be redeemed for cash.</li>
                <li>Free gems earned through daily rewards or voting cannot be converted to gold.</li>
                <li>We reserve the right to adjust the economy, including exchange rates and costs, at any time.</li>
                <li>Virtual balances may be reset or adjusted in the event of abuse, exploits, or as otherwise needed.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">4. User Conduct</h2>
              <p>You agree not to use Kira to:</p>
              <ul className="mt-3 space-y-1.5 list-disc list-inside text-white/60">
                <li>Generate, distribute, or request harmful, illegal, or abusive content</li>
                <li>Harass, threaten, or bully other users</li>
                <li>Attempt to exploit, hack, or manipulate the bot, its economy, or its systems</li>
                <li>Use automated tools or bots to interact with Kira</li>
                <li>Violate Discord's own Terms of Service</li>
              </ul>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">5. Content and Intellectual Property</h2>
              <p>Anime character data displayed through the gacha system is sourced from AniList (anilist.co) and is the property of their respective owners. Kira does not claim ownership of any character intellectual property. Character images are sourced from AniList's API under their terms of use.</p>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">6. Service Availability</h2>
              <p>We provide Kira on an "as is" and "as available" basis. We do not guarantee uninterrupted service. We reserve the right to modify, suspend, or discontinue Kira at any time without notice. We are not liable for any loss resulting from service interruptions.</p>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">7. Termination</h2>
              <p>We may terminate or restrict your access to Kira at any time, for any reason, including violations of these terms. You may stop using Kira at any time by removing it from your server.</p>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">8. Limitation of Liability</h2>
              <p>To the fullest extent permitted by law, we shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of Kira, including loss of virtual currency, content, or data.</p>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">9. Changes to Terms</h2>
              <p>We may update these terms at any time. Continued use of Kira after changes constitutes acceptance of the updated terms. We will announce major changes in our support server.</p>
            </section>

            <section>
              <h2 className="text-white text-base font-semibold mb-3">10. Contact</h2>
              <p>For questions about these terms, contact us via Kira's Discord support server or through her top.gg listing.</p>
            </section>
          </div>
        </div>
      </main>

      <footer className="border-t border-white/[0.06] py-8 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between text-xs text-white/20">
          <span>kira — a discord waifu bot</span>
          <div className="flex gap-4">
            <a href="/privacy" className="hover:text-white/40 transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-white/40 transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
