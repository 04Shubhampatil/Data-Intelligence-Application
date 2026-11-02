/** Decorative illustration for the dashboard welcome banner (document + magnifier). Hidden from assistive tech. */
export function HeroIllustration() {
  return (
    <svg aria-hidden viewBox="0 0 320 170" className="h-full w-auto">
      <defs>
        <linearGradient id="hi-doc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dbe7ff" />
        </linearGradient>
        <linearGradient id="hi-lens" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      {/* faint rings */}
      <circle cx="190" cy="85" r="78" fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1.5" />
      <circle cx="190" cy="85" r="58" fill="none" stroke="#ffffff" strokeOpacity="0.10" strokeWidth="1.5" />
      {/* back sheet */}
      <rect x="132" y="28" width="96" height="118" rx="12" fill="#ffffff" opacity="0.18" transform="rotate(-8 180 87)" />
      {/* document */}
      <rect x="146" y="22" width="96" height="122" rx="12" fill="url(#hi-doc)" />
      <rect x="160" y="40" width="48" height="7" rx="3.5" fill="#2563eb" />
      <rect x="160" y="56" width="66" height="5" rx="2.5" fill="#93b4f5" />
      <rect x="160" y="68" width="58" height="5" rx="2.5" fill="#93b4f5" />
      <rect x="160" y="80" width="62" height="5" rx="2.5" fill="#93b4f5" />
      <rect x="160" y="100" width="22" height="22" rx="5" fill="#bfd3fb" />
      <rect x="188" y="104" width="34" height="5" rx="2.5" fill="#93b4f5" />
      <rect x="188" y="114" width="26" height="5" rx="2.5" fill="#bfd3fb" />
      {/* magnifier */}
      <line x1="252" y1="118" x2="276" y2="142" stroke="#0b1f4d" strokeWidth="10" strokeLinecap="round" />
      <circle cx="238" cy="104" r="24" fill="#ffffff" />
      <circle cx="238" cy="104" r="18" fill="url(#hi-lens)" />
      <circle cx="231" cy="97" r="5" fill="#ffffff" opacity="0.55" />
    </svg>
  );
}
