import {
  crawlFollowLinksEnabled,
  crawlLinkPolicySnapshot,
} from './crawl-link-extract';
import {
  crawlSemanticDedupCrossSourceEnabled,
  crawlSemanticDedupEnabled,
} from './crawl-semantic-dedup';
import { crawlRespectRobotsEnabled } from './crawl-robots';

export function crawlRuntimeFeatures(): {
  httpFetch: boolean;
  playwright: boolean;
  followLinks: boolean;
  semanticDedup: boolean;
  crossSourceDedup: boolean;
  domFeatures: boolean;
  respectRobots: boolean;
} {
  return {
    httpFetch: process.env.CRAWL_HTTP_FETCH === 'true',
    playwright: process.env.CRAWL_USE_PLAYWRIGHT === 'true',
    followLinks: crawlFollowLinksEnabled(),
    semanticDedup: crawlSemanticDedupEnabled(),
    crossSourceDedup: crawlSemanticDedupCrossSourceEnabled(),
    domFeatures: process.env.CRAWL_DOM_FEATURES !== 'false',
    respectRobots: crawlRespectRobotsEnabled(),
  };
}

export function crawlWorkerRuntime(): {
  queueShard: string | null;
  processRole: string | null;
} {
  const shard = process.env.CRAWL_QUEUE_SHARD?.trim();
  return {
    queueShard: shard || null,
    processRole: process.env.PROCESS_ROLE?.trim() || null,
  };
}

export function crawlLinkPolicyForOverview() {
  return crawlLinkPolicySnapshot();
}
