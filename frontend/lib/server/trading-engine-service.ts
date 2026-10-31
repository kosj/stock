/** Production wiring only. The same pure engine is used by historical replay. */
import { TradingEngineService as CoreEngine, type TradingEngineDeps as CoreDeps } from "../core/trading-engine";
import { MockBrokerAdapter } from "./adapters/mock-broker-adapter";
import { YahooMarketDataAdapter } from "./adapters/yahoo-market-data-adapter";
import { SupabaseRecommendationAdapter } from "./adapters/supabase-recommendation-adapter";
import { KrMarketClock } from "./adapters/kr-market-clock";
import { SupabaseExecutionControl } from "./adapters/supabase-execution-control";
import { mockCosts } from "./mock-execution";
import type { BrokerPort } from "../core/ports/broker-port";
export type { TradeDetail, TradingResult } from "../core/trading-engine";
export type TradingEngineDeps = Partial<CoreDeps>;

export class TradingEngineService extends CoreEngine {
  constructor(broker: BrokerPort, deps: TradingEngineDeps = {}) {
    const execution = deps.execution ?? new SupabaseExecutionControl();
    if (broker instanceof MockBrokerAdapter && execution instanceof SupabaseExecutionControl)
      broker.bindExecutionOwner(execution.owner);
    super(broker, {
      marketData: deps.marketData ?? (broker instanceof MockBrokerAdapter ? broker.market : new YahooMarketDataAdapter()),
      recommendations: deps.recommendations ?? new SupabaseRecommendationAdapter(),
      clock: deps.clock ?? new KrMarketClock(),
      execution,
      costs: deps.costs ?? mockCosts,
      exposureLimits: deps.exposureLimits ?? {
        maxPositionWeight: Number(process.env.MOCK_MAX_POSITION_WEIGHT ?? .25),
        maxSectorWeight: Number(process.env.MOCK_MAX_SECTOR_WEIGHT ?? .5),
      },
    });
  }
  static mockForUser(userId: string, deps: TradingEngineDeps = {}) {
    const execution = deps.execution ?? new SupabaseExecutionControl();
    const owner = execution instanceof SupabaseExecutionControl ? execution.owner : undefined;
    return new TradingEngineService(new MockBrokerAdapter(userId, deps.marketData, owner), { ...deps, execution });
  }
}
