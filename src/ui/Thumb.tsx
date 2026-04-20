import { useState } from "react";

export function Thumb({ src, alt, size = 56 }: { src?: string; alt: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          flex: "0 0 auto",
          background:
            "linear-gradient(135deg, #1a1f2b 0%, #0e1119 100%)",
          border: "1px solid var(--border)",
        }}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        flex: "0 0 auto",
        objectFit: "cover",
        imageRendering: "pixelated",
        border: "1px solid var(--border)",
        background: "#0e1119",
      }}
    />
  );
}
