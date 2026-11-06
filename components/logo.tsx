/** Marca: um broche redondo com o "olho" de posicionamento de um QR Code. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="var(--color-enamel)" />
      <circle cx="16" cy="16" r="11.5" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1" />
      <rect x="9" y="9" width="8" height="8" rx="1.6" fill="#fff" />
      <rect x="11.3" y="11.3" width="3.4" height="3.4" rx=".6" fill="var(--color-enamel)" />
      <rect x="19" y="9" width="4" height="4" rx=".8" fill="#fff" />
      <rect x="9" y="19" width="4" height="4" rx=".8" fill="#fff" />
      <rect x="15" y="19" width="3" height="3" rx=".6" fill="#fff" />
      <rect x="19.5" y="15" width="3.5" height="3.5" rx=".7" fill="#fff" />
      <rect x="19.5" y="20" width="3.5" height="3" rx=".6" fill="#fff" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <LogoMark />
      <span className="text-lg">
        Broche<span className="text-enamel">Link</span>
      </span>
    </span>
  );
}
