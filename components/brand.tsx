import Link from "next/link";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${light ? "brand-light" : ""}`}
      aria-label="RpmDelivery — início"
    >
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <path d="M7 10h12l-4 6h10L14 26l3-8H7l4-5H7Z" fill="currentColor" />
        </svg>
      </span>
      <span>
        Rpm<span className="brand-delivery">Delivery</span>
      </span>
    </Link>
  );
}
