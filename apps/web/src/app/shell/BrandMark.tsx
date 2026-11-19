/** SEM Studio product mark: one latent circle linked to three indicator rectangles (STYLE.md section 7). */
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg
        viewBox="0 0 20 20"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="5" cy="10" r="3" />
        <path d="M8 10h3.5M8 8.2 11.5 4.5M8 11.8l3.5 3.7" />
        <rect x="12.5" y="2" width="6" height="4" rx="0.5" />
        <rect x="12.5" y="8" width="6" height="4" rx="0.5" />
        <rect x="12.5" y="14" width="6" height="4" rx="0.5" />
      </svg>
    </span>
  );
}
