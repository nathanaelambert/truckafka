export interface RouteProfile {
  ensureRoadDataMs: number;
  buildGraphMs: number;
  findNearestNodeMs: number;
  loadRoadEventsMs: number;
  bfsConnectivityMs: number;
  astarLoopMs: number;
  reconstructPathMs: number;
  nodeExpansions: number;
  edgeLookups: number;
  edgesEvaluated: number;
  edgesRelaxed: number;
  heuristicCalls: number;
  heuristicMs: number;
  graphNodes: number;
  graphEdges: number;
  cacheHit: boolean;
  dbQueries: number;
  totalMs: number;
}

export interface RouteDef {
  name: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  category: 'short' | 'medium' | 'long';
}

export interface RequestResult {
  ok: boolean;
  timedOut: boolean;
  httpStatus: number;
  latencyMs: number;
  isApproximate: boolean;
  profile: RouteProfile | null;
  error?: string;
}

export interface ConcurrencyResult {
  concurrency: number;
  cacheMode: 'cold' | 'warm';
  requests: RequestResult[];
  infraSamples: InfraSample[];
  totalDurationMs: number;
}

export interface InfraSample {
  timestamp: number;
  loadServiceCpuPct: number;
  loadServiceMemMB: number;
  dbCpuPct: number;
  dbMemMB: number;
  pgActiveConnections: number;
  pgTotalConnections: number;
  pgQueryLatencyMs: number;
}

export interface EnvInfo {
  cpuCores: number;
  cpuModel: string;
  totalRamGB: number;
  dockerResourceLimits: string;
  pgMaxConnections: number;
  pgSharedBuffers: string;
  pgEffectiveCacheSize: string;
  pgWorkMem: string;
  loadServicePort: number;
  benchmarkTimeoutMs: number;
  productionRouteTimeoutMs: number;
}
