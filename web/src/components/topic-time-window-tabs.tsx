import { siteTopicPath } from "@/lib/site-web-paths";

import { SiteTimeWindowTabs } from "@/components/site-time-window-tabs";

export function TopicTimeWindowTabs({
  slug,
  active,
}: {
  slug: string;
  active?: string;
}) {
  return (
    <SiteTimeWindowTabs
      active={active}
      hrefFor={(timeWindow) =>
        timeWindow === ""
          ? siteTopicPath(slug)
          : siteTopicPath(slug, { timeWindow })
      }
    />
  );
}
