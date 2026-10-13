import { type ConfirmedCoordinate, type Point, type TravelMatrix } from "./types.ts";

// Fictional confirmed points ONLY for demos. Never sent to Mapbox or presented as geocoded orders.
const coordinates = [
  [-46.65, -23.56], [-46.64, -23.55], [-46.62, -23.58], [-46.63, -23.54],
  [-46.66, -23.55], [-46.67, -23.57], [-46.63, -23.57], [-46.61, -23.56], [-46.64, -23.59],
] as const;
export function fixtureCoordinate(index: number): ConfirmedCoordinate {
  const [longitude, latitude] = coordinates[index];
  return { longitude, latitude, confirmed: true, source: "fixture" };
}
// Authored directed road graph: [from,to,seconds,meters]. One-way/asymmetric costs are intentional.
const edges = [
  [0,1,120,800], [1,0,240,1500], [0,2,600,4500], [2,0,420,3000],
  [1,2,480,3600], [2,1,180,1200], [1,3,120,700], [3,1,180,900],
  [3,4,180,1000], [4,0,180,1100], [0,4,240,1300], [4,3,120,800],
  [4,5,180,1200], [5,4,240,1500], [5,0,300,2000], [0,5,360,2200],
  [2,6,180,1000], [6,2,240,1600], [6,0,300,1900], [0,6,420,2700],
  [2,7,120,900], [7,2,180,1100], [7,3,360,2400], [3,7,420,2800],
  [6,8,120,800], [8,6,180,1200], [8,0,480,3500], [0,8,540,3900],
];
export function fixtureMatrix(points: Point[], scenario: string): TravelMatrix {
  const n = coordinates.length;
  const durations = Array.from({ length:n }, (_,i) => Array.from({length:n},(_,j) => i===j ? 0 : Infinity));
  const distances = durations.map(row => [...row]);
  for (const [i,j,seconds,meters] of edges) {
    durations[i][j] = scenario === "opt-near" ? seconds / 3 : seconds;
    distances[i][j] = scenario === "opt-near" ? meters / 3 : meters;
  }
  for(let k=0;k<n;k++)for(let i=0;i<n;i++)for(let j=0;j<n;j++){
    const seconds = durations[i][k]+durations[k][j];
    if(seconds < durations[i][j]){
      durations[i][j]=seconds; distances[i][j]=distances[i][k]+distances[k][j];
    }
  }
  const indexes = points.map(p => coordinates.findIndex(([lon,lat]) => p.coordinate.longitude===lon && p.coordinate.latitude===lat));
  if(indexes.some(i => i<0)) throw new Error("Coordenada demonstrativa ausente.");
  const project = (grid: number[][]) => indexes.map((i,a) => indexes.map((j,b) =>
    scenario==="opt-no-route" && a!==b && (i===1||j===1) ? null : grid[i][j]));
  return {pointIds:points.map(p=>p.id),coordinates:points.map(p=>p.coordinate),
    durations:project(durations),distances:project(distances),source:"fixture"};
}
