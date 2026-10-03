export function Ring() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
        <planeGeometry args={[10, 6]} />
        <meshStandardMaterial color="#d8d8cb" roughness={0.9} />
      </mesh>
      {[-2, -1.55, 1.55, 2].map((x, index) => (
        <mesh key={`rope-${index}`} position={[0, 0.6 + index * 0.34, x]}>
          <boxGeometry args={[8, 0.035, 0.035]} />
          <meshStandardMaterial color={index % 2 ? '#d78342' : '#5f98c7'} />
        </mesh>
      ))}
      <mesh position={[-1.4, 0.75, 0]}>
        <boxGeometry args={[0.75, 1.5, 0.55]} />
        <meshStandardMaterial color="#4284bd" roughness={0.55} />
      </mesh>
      <mesh position={[1.4, 0.75, 0]}>
        <boxGeometry args={[0.75, 1.5, 0.55]} />
        <meshStandardMaterial color="#da823f" roughness={0.55} />
      </mesh>
    </group>
  );
}
