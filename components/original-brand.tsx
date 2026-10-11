import Image from "next/image";
import originalBrand from "@/public/brand/rpmdelivery-original.png";

export function OriginalBrand() {
  return (
    <div className="original-brand">
      <Image
        src={originalBrand}
        alt="Marca original RpmDelivery"
        sizes="(max-width: 368px) calc(100vw - 48px), (max-width: 740px) 320px, (max-width: 1000px) calc(40vw - 56px), (min-width: 1292px) 490px, calc(46vw - 104px)"
        loading="eager"
      />
    </div>
  );
}
