import { memo } from 'react';
import { ICONS } from '../game/icons';

interface Props {
  name: string;
  color: string;
  size?: number;
  highlight?: string;
  dim?: string;
}

/** Renders one of the shared 9x9 pixel icons as a crisp SVG. */
export const PixelIcon = memo(function PixelIcon({ name, color, size = 27, highlight = '#ffffff', dim = '#4b5a80' }: Props) {
  const map = ICONS[name] ?? ICONS.lock;
  const rects: JSX.Element[] = [];
  map.forEach((row, y) => {
    row.split('').forEach((ch, x) => {
      if (ch === '.') return;
      const fill = ch === '+' ? highlight : ch === 'd' ? dim : color;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={fill} />);
    });
  });
  return (
    <svg
      viewBox={`0 0 ${map[0].length} ${map.length}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {rects}
    </svg>
  );
});
