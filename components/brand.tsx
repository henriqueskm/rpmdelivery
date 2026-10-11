import Image from "next/image";
import Link from "next/link";
import brandSymbol from "@/public/brand/rpmdelivery-symbol.png";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${light ? "brand-light" : ""}`}
      aria-label="RpmDelivery — início"
    >
      <span className="brand-mark" aria-hidden="true">
        <Image
          src={brandSymbol}
          alt=""
          sizes="(max-width: 740px) 60px, 66px"
          loading="eager"
        />
      </span>
      <span>
        Rpm<span className="brand-delivery">Delivery</span>
      </span>
    </Link>
  );
}
