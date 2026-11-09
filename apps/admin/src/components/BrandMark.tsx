/** The product mark: a four-point spark on the brand gradient. Decorative; pair it with the app name. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative, the wrapper is aria-hidden */}
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c.4 4.9 2.6 8.6 10 10-7.4 1.4-9.6 5.1-10 10-.4-4.9-2.6-8.6-10-10 7.4-1.4 9.6-5.1 10-10Z" />
      </svg>
    </span>
  );
}
