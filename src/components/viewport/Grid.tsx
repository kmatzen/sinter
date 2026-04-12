import { Grid as DreiGrid } from '@react-three/drei';

export function Grid() {
  return (
    <DreiGrid
      args={[200, 200]}
      cellSize={10}
      cellThickness={0.5}
      cellColor="#404040"
      sectionSize={50}
      sectionThickness={1}
      sectionColor="#606060"
      fadeDistance={300}
      fadeStrength={1}
      infiniteGrid
    />
  );
}
