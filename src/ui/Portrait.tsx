import { useEffect, useRef } from 'react';
import type { AstroObject } from '../astronomy/database/schema';
import { PORTRAIT_SIZE, portraitFor } from '../game/render/portrait';

interface Props {
  object: AstroObject;
  /** Rotate procedural bodies slowly. */
  animate?: boolean;
}

/** Pixel portrait of a catalogue object, upscaled with nearest-neighbour filtering. */
export function Portrait({ object, animate = true }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    const portrait = portraitFor(object);
    const start = performance.now();
    const paint = (): void => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#04050b';
      ctx.fillRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
      portrait.draw(ctx, (performance.now() - start) / 1000);
    };
    paint();
    if (!animate || !portrait.animated) return;
    // Ten frames a second is plenty for a slowly turning pixel planet.
    const timer = window.setInterval(paint, 100);
    return () => window.clearInterval(timer);
  }, [object, animate]);

  return <canvas ref={ref} className="portrait" width={PORTRAIT_SIZE} height={PORTRAIT_SIZE} aria-label={`Pixel rendering of ${object.name}`} />;
}
