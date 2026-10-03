interface RobotAvatarProps {
  compact?: boolean;
}

export function RobotAvatar({ compact = false }: RobotAvatarProps) {
  return (
    <div
      className={`robot-avatar${compact ? ' compact' : ''}`}
      role="img"
      aria-label="Placeholder robot boxer"
    >
      <span className="robot-shadow" />
      <span className="robot-leg leg-left" />
      <span className="robot-leg leg-right" />
      <span className="robot-body">
        <i />
      </span>
      <span className="robot-head">
        <i />
        <b />
      </span>
      <span className="robot-arm arm-left">
        <i />
      </span>
      <span className="robot-arm arm-right">
        <i />
      </span>
    </div>
  );
}
