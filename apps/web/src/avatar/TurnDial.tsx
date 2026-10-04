const RADIUS = 46;
const HALF_WEDGE = 18;

function arc(fromDeg: number, toDeg: number) {
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${Math.sin(rad) * RADIUS} ${-Math.cos(rad) * RADIUS}`;
  };
  return `M ${point(fromDeg)} A ${RADIUS} ${RADIUS} 0 0 1 ${point(toDeg)}`;
}

/** Ring of capture slots (lit when captured) with a needle at the current turn angle. */
export function TurnDial({ slots, yawDeg }: { slots: readonly boolean[]; yawDeg: number | null }) {
  const step = 360 / slots.length;
  const captured = slots.filter(Boolean).length;
  const needle = yawDeg === null ? null : (yawDeg * Math.PI) / 180;
  return (
    <svg className="turn-dial" viewBox="-60 -60 120 120" role="img" aria-label={`${captured} of ${slots.length} angles captured`}>
      {slots.map((filled, index) => (
        <path
          key={index}
          className={filled ? 'is-filled' : undefined}
          d={arc(index * step - HALF_WEDGE, index * step + HALF_WEDGE)}
        />
      ))}
      {needle === null ? null : (
        <line className="turn-dial-needle" x1="0" y1="0" x2={Math.sin(needle) * 34} y2={-Math.cos(needle) * 34} />
      )}
      <circle className="turn-dial-hub" r="4" />
    </svg>
  );
}
