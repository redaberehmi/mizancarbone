// Badge SVG repris tel quel du brief (section 3) — balance à levier, jamais
// des plateaux suspendus par des fils (évoquerait la balance de la Justice).
export function Badge({ size = 40, className = '' }) {
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="mizancarbone"
    >
      <rect width="200" height="200" rx="32" fill="#0B6E4F" />
      <line x1="55" y1="90" x2="145" y2="90" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
      <circle cx="55" cy="80" r="10" fill="#FFFFFF" />
      <circle cx="145" cy="80" r="10" fill="#FFFFFF" />
      <path d="M100 90 L84 122 L116 122 Z" fill="#FFFFFF" />
      <line x1="80" y1="122" x2="120" y2="122" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className = '' }) {
  return (
    <span className={`font-display text-xl ${className}`}>
      <span className="font-bold text-mizan-vert">mizan</span>
      <span className="font-normal text-mizan-gris">carbone</span>
    </span>
  );
}

export function Logo({ badgeSize = 36, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Badge size={badgeSize} />
      <Wordmark />
    </span>
  );
}
