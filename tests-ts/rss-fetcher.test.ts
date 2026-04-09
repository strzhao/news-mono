import { afterEach, describe, expect, it } from "vitest";
import type { SourceConfig } from "@/lib/domain/models";
import { fetchArticles } from "@/lib/fetch/rss-fetcher";

const originalFetch = globalThis.fetch;

function source(id: string, url: string): SourceConfig {
  return {
    id,
    name: id,
    url,
    sourceWeight: 1,
    sourceType: "rss",
    onlyExternalLinks: false,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.WECHAT_SOGOU_MAX_AGE_DAYS;
});

describe("rss fetcher", () => {
  it("continues to next source when one source times out", async () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Feed</title>
    <item>
      <title>Fast Article</title>
      <link>https://example.com/fast</link>
      <description>Quick summary.</description>
      <pubDate>Sat, 28 Feb 2026 16:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof URL ? input.toString() : input);
      if (url.includes("slow.example.com")) {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }
        });
      }
      return new Response(rss, {
        status: 200,
        headers: {
          "content-type": "application/rss+xml",
        },
      });
    }) as typeof fetch;

    const startedAt = Date.now();
    const result = await fetchArticles(
      [
        source("slow", "https://slow.example.com/rss"),
        source("fast", "https://fast.example.com/rss"),
      ],
      {
        timeoutSeconds: 1,
      },
    );

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].sourceId).toBe("fast");
    expect(result.articles[0].title).toBe("Fast Article");
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("supports WeChat Sogou search pages and resolves mp article links", async () => {
    process.env.WECHAT_SOGOU_MAX_AGE_DAYS = "3";
    const sogouSearchHtml = `
<!doctype html>
<html>
<body>
  <ul class="news-list">
    <li id="sogou_vr_11002601_box_0">
      <div class="txt-box">
        <a target="_blank" href="/link?url=article-1&type=2&query=Rockhazix&token=token-1" id="sogou_vr_11002601_title_0">用AI的这三年,想跟你分享这9条心得.</a>
        <p class="txt-info">今天,就是这个小破公众号的3周年了.</p>
        <div class="s-p">
          <span class="all-time-y2">数字生命卡兹克</span><span class="s2"><script>document.write(timeConvert('1771899524'))</script></span>
        </div>
      </div>
    </li>
    <li id="sogou_vr_11002601_box_1">
      <div class="txt-box">
        <a target="_blank" href="/link?url=article-2&type=2&query=Rockhazix&token=token-1" id="sogou_vr_11002601_title_1">本地部署 OpenClaw,淘宝报价一百到五百</a>
        <p class="txt-info">这篇不是目标账号自己的文章.</p>
        <div class="s-p">
          <span class="all-time-y2">每日AIGC探索</span><span class="s2"><script>document.write(timeConvert('1773122734'))</script></span>
        </div>
      </div>
    </li>
  </ul>
</body>
</html>`.trim();

    const sogouRedirectHtml = `
<script>
  setTimeout(function () {
    var url = '';
    url += 'https://mp.';
    url += 'weixin.qq.c';
    url += 'om/s?src=11';
    url += '&timestamp=1774930840&';
    url += 'ver=6631&signature=test-signature&new=1';
    url.replace("@", "");
    window.location.replace(url)
  }, 100);
</script>`.trim();

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof URL ? input.toString() : input);
      if (url.includes("weixin.sogou.com/weixin?type=2&query=Rockhazix")) {
        return {
          ok: true,
          text: async () => sogouSearchHtml,
          headers: {
            get: () => null,
            getSetCookie: () => ["SUID=search-cookie; Path=/"],
          },
        } as unknown as Response;
      }

      if (url.includes("weixin.sogou.com/link?url=article-1")) {
        return {
          ok: true,
          text: async () => sogouRedirectHtml,
          headers: {
            get: () => null,
            getSetCookie: () => [],
          },
        } as unknown as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await fetchArticles(
      [
        {
          id: "wechat_khazix0918",
          name: "数字生命卡兹克（微信）",
          url: "https://example.com/wewe.atom",
          sourceWeight: 1,
          sourceType: "wechat",
          onlyExternalLinks: false,
          fetchMethod: "wechat_sogou",
          wechatSogouQuery: "Rockhazix",
        },
      ],
      { timeoutSeconds: 2, reportDate: "2026-02-24", timezoneName: "Asia/Shanghai" },
    );

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].sourceId).toBe("wechat_khazix0918");
    expect(result.articles[0].title).toContain("用AI的这三年");
    expect(result.articles[0].url).toContain("https://mp.weixin.qq.com/s?src=11");
    expect(result.articles[0].summaryRaw).toContain("3周年");
  });

  it("falls back to RSS when Sogou returns no matching WeChat author", async () => {
    process.env.WECHAT_SOGOU_MAX_AGE_DAYS = "30";
    const emptySogouHtml = `
<!doctype html>
<html>
<body>
  <ul class="news-list">
    <li id="sogou_vr_11002601_box_0">
      <div class="txt-box">
        <a target="_blank" href="/link?url=article-2&type=2&query=qbitai&token=token-1" id="sogou_vr_11002601_title_0">旁路文章</a>
        <p class="txt-info">不是量子位自己的文章.</p>
        <div class="s-p">
          <span class="all-time-y2">别的公众号</span><span class="s2"><script>document.write(timeConvert('1773122734'))</script></span>
        </div>
      </div>
    </li>
  </ul>
</body>
</html>`.trim();

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Feed</title>
    <item>
      <title>量子位 RSS 兜底文章</title>
      <link>https://mp.weixin.qq.com/s?__fallback=1</link>
      <description>来自 WeWe 的兜底内容。</description>
      <pubDate>Sat, 28 Feb 2026 16:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof URL ? input.toString() : input);
      if (url.includes("weixin.sogou.com/weixin?type=2&query=%E9%87%8F%E5%AD%90%E4%BD%8D")) {
        return {
          ok: true,
          text: async () => emptySogouHtml,
          headers: {
            get: () => null,
            getSetCookie: () => ["SUID=search-cookie; Path=/"],
          },
        } as unknown as Response;
      }

      if (url.includes("example.com/wewe-qbitai.atom")) {
        return new Response(rss, {
          status: 200,
          headers: {
            "content-type": "application/rss+xml",
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await fetchArticles(
      [
        {
          id: "wechat_qbitai",
          name: "量子位（微信）",
          url: "https://example.com/wewe-qbitai.atom",
          sourceWeight: 1,
          sourceType: "wechat",
          onlyExternalLinks: false,
          fetchMethod: "wechat_sogou",
          fallbackFetchMethod: "rss",
          wechatSogouQuery: "量子位",
        },
      ],
      { timeoutSeconds: 2, reportDate: "2026-03-10", timezoneName: "Asia/Shanghai" },
    );

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].sourceId).toBe("wechat_qbitai");
    expect(result.articles[0].title).toBe("量子位 RSS 兜底文章");
    expect(result.articles[0].url).toBe("https://mp.weixin.qq.com/s?__fallback=1");
  });

  it("skips broken Sogou redirect pages and keeps later matched articles", async () => {
    process.env.WECHAT_SOGOU_MAX_AGE_DAYS = "3";
    const sogouSearchHtml = `
<!doctype html>
<html>
<body>
  <ul class="news-list">
    <li id="sogou_vr_11002601_box_0">
      <div class="txt-box">
        <a target="_blank" href="/link?url=article-1&type=2&query=Rockhazix&token=token-1" id="sogou_vr_11002601_title_0">第一篇</a>
        <p class="txt-info">第一篇摘要.</p>
        <div class="s-p">
          <span class="all-time-y2">数字生命卡兹克</span><span class="s2"><script>document.write(timeConvert('1771899524'))</script></span>
        </div>
      </div>
    </li>
    <li id="sogou_vr_11002601_box_1">
      <div class="txt-box">
        <a target="_blank" href="/link?url=article-2&type=2&query=Rockhazix&token=token-1" id="sogou_vr_11002601_title_1">第二篇</a>
        <p class="txt-info">第二篇摘要.</p>
        <div class="s-p">
          <span class="all-time-y2">数字生命卡兹克</span><span class="s2"><script>document.write(timeConvert('1771899530'))</script></span>
        </div>
      </div>
    </li>
  </ul>
</body>
</html>`.trim();

    const sogouRedirectHtml = `
<script>
  setTimeout(function () {
    var url = "";
    url += "https://mp.";
    url += "weixin.qq.c";
    url += "om/s?src=11";
    url += "&timestamp=1774930840&";
    url += "ver=6631&signature=second";
    url += "&new=1";
    url.replace("@", "");
    window.location.replace(url)
  }, 100);
</script>`.trim();

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof URL ? input.toString() : input);
      if (url.includes("weixin.sogou.com/weixin?type=2&query=Rockhazix")) {
        return {
          ok: true,
          text: async () => sogouSearchHtml,
          headers: {
            get: () => null,
            getSetCookie: () => ["SUID=search-cookie; Path=/"],
          },
        } as unknown as Response;
      }

      if (url.includes("weixin.sogou.com/link?url=article-1")) {
        throw new Error("socket hang up");
      }

      if (url.includes("weixin.sogou.com/link?url=article-2")) {
        return {
          ok: true,
          text: async () => sogouRedirectHtml,
          headers: {
            get: () => null,
            getSetCookie: () => [],
          },
        } as unknown as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await fetchArticles(
      [
        {
          id: "wechat_khazix0918",
          name: "数字生命卡兹克（微信）",
          url: "https://example.com/wechat-khazix",
          sourceWeight: 1,
          sourceType: "wechat",
          onlyExternalLinks: false,
          fetchMethod: "wechat_sogou",
          wechatSogouQuery: "Rockhazix",
        },
      ],
      { timeoutSeconds: 2, reportDate: "2026-02-24", timezoneName: "Asia/Shanghai" },
    );

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].title).toBe("第二篇");
    expect(result.articles[0].url).toContain("signature=second");
  });

  it("prefers fresher matched WeChat articles before slicing", async () => {
    process.env.WECHAT_SOGOU_MAX_AGE_DAYS = "7";
    const sogouSearchHtml = `
<!doctype html>
<html>
<body>
  <ul class="news-list">
    <li id="sogou_vr_11002601_box_0">
      <div class="txt-box">
        <a target="_blank" href="/link?url=old-article&type=2&query=QbitAI&token=token-1" id="sogou_vr_11002601_title_0">旧文章</a>
        <p class="txt-info">旧摘要.</p>
        <div class="s-p">
          <span class="all-time-y2">量子位</span><span class="s2"><script>document.write(timeConvert('1704067200'))</script></span>
        </div>
      </div>
    </li>
    <li id="sogou_vr_11002601_box_1">
      <div class="txt-box">
        <a target="_blank" href="/link?url=new-article&type=2&query=QbitAI&token=token-1" id="sogou_vr_11002601_title_1">新文章</a>
        <p class="txt-info">新摘要.</p>
        <div class="s-p">
          <span class="all-time-y2">量子位</span><span class="s2"><script>document.write(timeConvert('1775452999'))</script></span>
        </div>
      </div>
    </li>
  </ul>
</body>
</html>`.trim();

    const oldRedirectHtml = `
<script>
  var url = '';
  url += 'https://mp.';
  url += 'weixin.qq.c';
  url += 'om/s?src=11&signature=old';
</script>`.trim();

    const newRedirectHtml = `
<script>
  var url = '';
  url += 'https://mp.';
  url += 'weixin.qq.c';
  url += 'om/s?src=11&signature=new';
</script>`.trim();

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof URL ? input.toString() : input);
      if (url.includes("weixin.sogou.com/weixin?type=2&query=QbitAI")) {
        return {
          ok: true,
          text: async () => sogouSearchHtml,
          headers: {
            get: () => null,
            getSetCookie: () => ["SUID=search-cookie; Path=/"],
          },
        } as unknown as Response;
      }

      if (url.includes("weixin.sogou.com/link?url=old-article")) {
        return {
          ok: true,
          text: async () => oldRedirectHtml,
          headers: {
            get: () => null,
            getSetCookie: () => [],
          },
        } as unknown as Response;
      }

      if (url.includes("weixin.sogou.com/link?url=new-article")) {
        return {
          ok: true,
          text: async () => newRedirectHtml,
          headers: {
            get: () => null,
            getSetCookie: () => [],
          },
        } as unknown as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await fetchArticles(
      [
        {
          id: "wechat_qbitai",
          name: "量子位（微信）",
          url: "https://example.com/wewe-qbitai.atom",
          sourceWeight: 1,
          sourceType: "wechat",
          onlyExternalLinks: false,
          fetchMethod: "wechat_sogou",
          wechatSogouQuery: "QbitAI",
        },
      ],
      {
        timeoutSeconds: 2,
        maxPerSource: 1,
        reportDate: "2026-04-07",
        timezoneName: "Asia/Shanghai",
      },
    );

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].title).toBe("新文章");
    expect(result.articles[0].url).toContain("signature=new");
  });

  it("falls back to RSS when matched WeChat articles are stale", async () => {
    process.env.WECHAT_SOGOU_MAX_AGE_DAYS = "7";

    const staleSogouHtml = `
<!doctype html>
<html>
<body>
  <ul class="news-list">
    <li id="sogou_vr_11002601_box_0">
      <div class="txt-box">
        <a target="_blank" href="/link?url=old-article&type=2&query=%E6%96%B0%E6%99%BA%E5%85%83&token=token-1" id="sogou_vr_11002601_title_0">旧的公众号文章</a>
        <p class="txt-info">这是旧文章.</p>
        <div class="s-p">
          <span class="all-time-y2">新智元</span><span class="s2"><script>document.write(timeConvert('1704067200'))</script></span>
        </div>
      </div>
    </li>
  </ul>
</body>
</html>`.trim();

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Feed</title>
    <item>
      <title>新智元 RSS 兜底文章</title>
      <link>https://mp.weixin.qq.com/s?__fallback=stale</link>
      <description>来自 WeWe 的兜底内容。</description>
      <pubDate>Sun, 06 Apr 2026 16:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof URL ? input.toString() : input);
      if (url.includes("weixin.sogou.com/weixin?type=2&query=%E6%96%B0%E6%99%BA%E5%85%83")) {
        return {
          ok: true,
          text: async () => staleSogouHtml,
          headers: {
            get: () => null,
            getSetCookie: () => ["SUID=search-cookie; Path=/"],
          },
        } as unknown as Response;
      }

      if (url.includes("example.com/wewe-xinzhiyuan.atom")) {
        return new Response(rss, {
          status: 200,
          headers: {
            "content-type": "application/rss+xml",
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await fetchArticles(
      [
        {
          id: "wechat_xinzhiyuan",
          name: "新智元（微信）",
          url: "https://example.com/wewe-xinzhiyuan.atom",
          sourceWeight: 1,
          sourceType: "wechat",
          onlyExternalLinks: false,
          fetchMethod: "wechat_sogou",
          fallbackFetchMethod: "rss",
          wechatSogouQuery: "新智元",
        },
      ],
      { timeoutSeconds: 2 },
    );

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].title).toBe("新智元 RSS 兜底文章");
    expect(result.articles[0].url).toBe("https://mp.weixin.qq.com/s?__fallback=stale");
  });

  it("filters stale WeChat RSS fallback entries by report date window", async () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Feed</title>
    <item>
      <title>旧的兜底文章</title>
      <link>https://mp.weixin.qq.com/s?__fallback=old</link>
      <description>旧内容。</description>
      <pubDate>Thu, 20 Mar 2026 02:18:41 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    globalThis.fetch = (async () =>
      new Response(rss, {
        status: 200,
        headers: {
          "content-type": "application/rss+xml",
        },
      })) as typeof fetch;

    const result = await fetchArticles(
      [
        {
          id: "wechat_khazix0918",
          name: "数字生命卡兹克（微信）",
          url: "https://example.com/wewe-khazix.atom",
          sourceWeight: 1,
          sourceType: "wechat",
          onlyExternalLinks: false,
          fetchMethod: "rss",
        },
      ],
      {
        timeoutSeconds: 2,
        reportDate: "2026-04-09",
        timezoneName: "Asia/Shanghai",
      },
    );

    expect(result.articles).toHaveLength(0);
  });
});
