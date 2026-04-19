import { useState, useEffect, useRef } from "react";

const DEMO_TRACKS = [
  {
    title: "Blinding Lights",
    artist: "The Weeknd",
    duration: 200,
    hue: 320,
  },
  {
    title: "As It Was",
    artist: "Harry Styles",
    duration: 167,
    hue: 200,
  },
  {
    title: "Heat Waves",
    artist: "Glass Animals",
    duration: 238,
    hue: 160,
  },
  {
    title: "Stay",
    artist: "The Kid LAROI & Justin Bieber",
    duration: 141,
    hue: 40,
  },
];

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function VinylDisc({
  spinning,
  hue,
  onClick,
}: {
  spinning: boolean;
  hue: number;
  onClick: () => void;
}) {
  const rotRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastTs = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;

    function draw(ts: number) {
      if (spinning) {
        const delta = lastTs.current !== null ? ts - lastTs.current : 0;
        rotRef.current += (delta / 1000) * (360 * 0.42);
        if (rotRef.current >= 360) rotRef.current -= 360;
      }
      lastTs.current = ts;

      ctx.clearRect(0, 0, size, size);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rotRef.current * Math.PI) / 180);

      // Outer ring — deep black with subtle groove rings
      const outerGrad = ctx.createRadialGradient(0, 0, cx * 0.1, 0, 0, cx);
      outerGrad.addColorStop(0, `hsl(${hue},60%,28%)`);
      outerGrad.addColorStop(0.28, `hsl(${hue},15%,10%)`);
      outerGrad.addColorStop(0.55, `hsl(${hue},12%,7%)`);
      outerGrad.addColorStop(0.88, `hsl(${hue},14%,9%)`);
      outerGrad.addColorStop(1, `hsl(${hue},20%,14%)`);

      ctx.beginPath();
      ctx.arc(0, 0, cx * 0.97, 0, Math.PI * 2);
      ctx.fillStyle = outerGrad;
      ctx.fill();

      // Groove rings
      for (let r = 0.35; r <= 0.93; r += 0.035) {
        ctx.beginPath();
        ctx.arc(0, 0, cx * r, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue},20%,100%,0.04)`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Rim sheen
      const rimGrad = ctx.createRadialGradient(
        -cx * 0.25,
        -cx * 0.25,
        cx * 0.7,
        0,
        0,
        cx * 0.97
      );
      rimGrad.addColorStop(0, `hsla(${hue},40%,85%,0.07)`);
      rimGrad.addColorStop(0.6, `hsla(${hue},20%,100%,0.02)`);
      rimGrad.addColorStop(1, `hsla(${hue},20%,100%,0.0)`);
      ctx.beginPath();
      ctx.arc(0, 0, cx * 0.97, 0, Math.PI * 2);
      ctx.fillStyle = rimGrad;
      ctx.fill();

      // Label area (inner coloured circle)
      const labelRad = cx * 0.32;
      const labelGrad = ctx.createRadialGradient(
        -labelRad * 0.3,
        -labelRad * 0.3,
        0,
        0,
        0,
        labelRad
      );
      labelGrad.addColorStop(0, `hsl(${hue},55%,40%)`);
      labelGrad.addColorStop(0.5, `hsl(${hue},60%,28%)`);
      labelGrad.addColorStop(1, `hsl(${hue},65%,16%)`);
      ctx.beginPath();
      ctx.arc(0, 0, labelRad, 0, Math.PI * 2);
      ctx.fillStyle = labelGrad;
      ctx.fill();

      // Label sheen
      const labelSheen = ctx.createRadialGradient(
        -labelRad * 0.4,
        -labelRad * 0.5,
        0,
        0,
        0,
        labelRad
      );
      labelSheen.addColorStop(0, `hsla(0,0%,100%,0.18)`);
      labelSheen.addColorStop(0.45, `hsla(0,0%,100%,0.04)`);
      labelSheen.addColorStop(1, `hsla(0,0%,100%,0)`);
      ctx.beginPath();
      ctx.arc(0, 0, labelRad, 0, Math.PI * 2);
      ctx.fillStyle = labelSheen;
      ctx.fill();

      // Centre spindle
      const spindleGrad = ctx.createRadialGradient(
        -cx * 0.01,
        -cx * 0.01,
        0,
        0,
        0,
        cx * 0.055
      );
      spindleGrad.addColorStop(0, "rgba(255,255,255,0.9)");
      spindleGrad.addColorStop(0.4, "rgba(220,220,220,0.6)");
      spindleGrad.addColorStop(1, "rgba(160,160,160,0.3)");
      ctx.beginPath();
      ctx.arc(0, 0, cx * 0.055, 0, Math.PI * 2);
      ctx.fillStyle = spindleGrad;
      ctx.fill();

      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [spinning, hue]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={240}
      onClick={onClick}
      className="cursor-pointer select-none"
      style={{
        borderRadius: "50%",
        filter: spinning
          ? `drop-shadow(0 0 28px hsla(${hue},70%,55%,0.45)) drop-shadow(0 8px 24px rgba(0,0,0,0.7))`
          : `drop-shadow(0 0 6px hsla(${hue},50%,40%,0.25)) drop-shadow(0 8px 24px rgba(0,0,0,0.7))`,
        transition: "filter 0.4s ease",
      }}
    />
  );
}

function IconBtn({
  onClick,
  active = false,
  danger = false,
  children,
  title,
  size = "md",
}: {
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
  title?: string;
  size?: "sm" | "md";
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      title={title}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onClick={onClick}
      className="flex items-center justify-center rounded-full transition-all select-none"
      style={{
        width: size === "sm" ? 36 : 44,
        height: size === "sm" ? 36 : 44,
        background: danger
          ? pressed
            ? "rgba(239,68,68,0.6)"
            : "rgba(239,68,68,0.18)"
          : active
          ? "rgba(255,255,255,0.18)"
          : pressed
          ? "rgba(255,255,255,0.14)"
          : "rgba(255,255,255,0.07)",
        border: `1px solid ${
          danger
            ? "rgba(239,68,68,0.4)"
            : active
            ? "rgba(255,255,255,0.35)"
            : "rgba(255,255,255,0.12)"
        }`,
        transform: pressed ? "scale(0.9)" : "scale(1)",
        color: danger
          ? "rgb(252,165,165)"
          : active
          ? "white"
          : "rgba(255,255,255,0.65)",
      }}
    >
      {children}
    </button>
  );
}

export function NowPlaying() {
  const [trackIdx, setTrackIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(80);
  const [progress, setProgress] = useState(32);
  const [dragging, setDragging] = useState(false);

  const track = DEMO_TRACKS[trackIdx];

  useEffect(() => {
    if (!playing || dragging) return;
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= track.duration) {
          if (loop) return 0;
          setTrackIdx((i) => (i + 1) % DEMO_TRACKS.length);
          return 0;
        }
        return p + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [playing, dragging, track.duration, loop]);

  function prev() {
    setTrackIdx((i) => (i - 1 + DEMO_TRACKS.length) % DEMO_TRACKS.length);
    setProgress(0);
  }
  function next() {
    setTrackIdx((i) => (i + 1) % DEMO_TRACKS.length);
    setProgress(0);
  }
  function stop() {
    setPlaying(false);
    setProgress(0);
  }

  const pct = Math.min((progress / track.duration) * 100, 100);
  const { hue } = track;

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background: `radial-gradient(ellipse 90% 70% at 50% 30%, hsl(${hue},35%,10%) 0%, hsl(${hue},20%,5%) 60%, #060608 100%)`,
      }}
    >
      <div
        className="relative flex flex-col items-center gap-0 w-full max-w-[340px] mx-4 overflow-hidden"
        style={{
          background: `linear-gradient(160deg, hsla(${hue},30%,18%,0.55) 0%, hsla(${hue},20%,8%,0.75) 100%)`,
          border: `1px solid hsla(${hue},40%,60%,0.18)`,
          borderRadius: 24,
          backdropFilter: "blur(20px)",
          boxShadow: `0 32px 80px rgba(0,0,0,0.65), 0 0 0 1px hsla(${hue},40%,60%,0.08) inset`,
        }}
      >
        {/* top glow bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "15%",
            right: "15%",
            height: 1,
            background: `linear-gradient(90deg, transparent, hsla(${hue},70%,70%,0.5), transparent)`,
          }}
        />

        {/* Header */}
        <div className="flex items-center justify-between w-full px-5 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: playing
                  ? `hsl(${hue},70%,65%)`
                  : "rgba(255,255,255,0.25)",
                boxShadow: playing
                  ? `0 0 8px hsl(${hue},70%,60%)`
                  : "none",
                transition: "all 0.3s ease",
              }}
            />
            <span
              className="text-xs font-semibold tracking-widest uppercase"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              Now Playing
            </span>
          </div>
          <div className="flex items-center gap-1">
            {DEMO_TRACKS.map((_, i) => (
              <button
                key={i}
                onClick={() => { setTrackIdx(i); setProgress(0); }}
                className="rounded-full transition-all"
                style={{
                  width: i === trackIdx ? 16 : 5,
                  height: 5,
                  background:
                    i === trackIdx
                      ? `hsl(${hue},65%,60%)`
                      : "rgba(255,255,255,0.2)",
                }}
              />
            ))}
          </div>
        </div>

        {/* Vinyl + glow */}
        <div className="relative flex items-center justify-center my-2 py-1">
          <div
            className="absolute rounded-full"
            style={{
              width: 220,
              height: 220,
              background: `radial-gradient(circle, hsla(${hue},65%,50%,${playing ? 0.22 : 0.06}) 0%, transparent 70%)`,
              filter: "blur(24px)",
              transition: "background 0.5s ease",
            }}
          />
          <VinylDisc
            spinning={playing}
            hue={hue}
            onClick={() => setPlaying((p) => !p)}
          />
          {/* Pause indicator overlay */}
          {!playing && (
            <div
              className="absolute flex items-center justify-center"
              style={{
                width: 240,
                height: 240,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.38)",
                backdropFilter: "blur(2px)",
              }}
            >
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                <rect x="11" y="10" width="8" height="24" rx="3" fill="rgba(255,255,255,0.85)" />
                <rect x="25" y="10" width="8" height="24" rx="3" fill="rgba(255,255,255,0.85)" />
              </svg>
            </div>
          )}
        </div>

        {/* Track info */}
        <div className="flex flex-col items-center gap-0.5 px-6 text-center">
          <h2
            className="text-lg font-bold tracking-tight text-white leading-tight"
            style={{ textShadow: `0 0 32px hsla(${hue},70%,70%,0.4)` }}
          >
            {track.title}
          </h2>
          <p className="text-sm" style={{ color: `hsla(${hue},50%,75%,0.75)` }}>
            {track.artist}
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full px-5 mt-4 space-y-1">
          <div
            className="relative h-1.5 rounded-full cursor-pointer"
            style={{ background: "rgba(255,255,255,0.1)" }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const ratio = Math.max(0, Math.min(1, x / rect.width));
              setProgress(Math.round(ratio * track.duration));
            }}
            onMouseDown={() => setDragging(true)}
            onMouseUp={() => setDragging(false)}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all"
              style={{
                width: `${pct}%`,
                background: `linear-gradient(90deg, hsl(${hue},65%,55%), hsl(${hue},75%,75%))`,
                boxShadow: `0 0 8px hsla(${hue},70%,65%,0.6)`,
              }}
            />
            {/* Thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 bg-white"
              style={{
                left: `calc(${pct}% - 6px)`,
                borderColor: `hsl(${hue},70%,65%)`,
                boxShadow: `0 0 8px hsla(${hue},70%,65%,0.7)`,
              }}
            />
          </div>
          <div className="flex justify-between text-xs" style={{ color: "rgba(255,255,255,0.38)" }}>
            <span>{formatTime(progress)}</span>
            <span>{formatTime(track.duration)}</span>
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-center gap-3 mt-3 px-5">
          {/* Previous */}
          <IconBtn onClick={prev} title="Previous" size="md">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </IconBtn>

          {/* Play / Pause — bigger */}
          <button
            onClick={() => setPlaying((p) => !p)}
            className="flex items-center justify-center rounded-full transition-all select-none"
            style={{
              width: 62,
              height: 62,
              background: `linear-gradient(135deg, hsl(${hue},65%,52%), hsl(${hue},70%,38%))`,
              boxShadow: `0 0 24px hsla(${hue},70%,55%,0.5), 0 6px 16px rgba(0,0,0,0.4)`,
              border: `1px solid hsla(${hue},60%,70%,0.35)`,
              color: "white",
            }}
            onMouseDown={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.transform = "scale(0.93)")
            }
            onMouseUp={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)")
            }
          >
            {playing ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="5" width="4" height="14" rx="2" />
                <rect x="14" y="5" width="4" height="14" rx="2" />
              </svg>
            ) : (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="white"
                style={{ marginLeft: 3 }}
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Next */}
          <IconBtn onClick={next} title="Next" size="md">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
            </svg>
          </IconBtn>
        </div>

        {/* Secondary controls */}
        <div className="flex items-center justify-between w-full px-5 mt-3 pb-5">
          {/* Loop */}
          <IconBtn onClick={() => setLoop((l) => !l)} active={loop} title="Loop" size="sm">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
            </svg>
          </IconBtn>

          {/* Volume row */}
          <div className="flex items-center gap-2 flex-1 mx-3">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="rgba(255,255,255,0.4)"
            >
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
            </svg>
            <div className="flex-1 relative h-1.5 rounded-full cursor-pointer"
              style={{ background: "rgba(255,255,255,0.1)" }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                setVolume(Math.round(Math.max(0, Math.min(100, (x / rect.width) * 100))));
              }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${volume}%`,
                  background: `linear-gradient(90deg, hsla(${hue},55%,55%,0.8), hsla(${hue},65%,70%,0.9))`,
                }}
              />
            </div>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="rgba(255,255,255,0.4)"
            >
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          </div>

          {/* Stop */}
          <IconBtn onClick={stop} danger title="Stop" size="sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h12v12H6z" />
            </svg>
          </IconBtn>
        </div>

        {/* Queue pill at bottom */}
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.4)",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
          </svg>
          {DEMO_TRACKS.length - 1} in queue
        </div>
      </div>
    </div>
  );
}
