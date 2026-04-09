import { repairWechatDailyArchives } from "@/lib/article-db/repository";
import { getWechatFreshnessMaxAgeDays } from "@/lib/domain/article-identity";

function argValue(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  return String(process.argv[index + 1] || "").trim();
}

async function main(): Promise<void> {
  const fromDate = argValue("--from");
  const toDate = argValue("--to");
  const timezoneName =
    argValue("--tz") ||
    String(process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() ||
    "Asia/Shanghai";
  const maxAgeDays = getWechatFreshnessMaxAgeDays(
    argValue("--max-age-days") ||
      String(
        process.env.INGESTION_WECHAT_RESERVED_MAX_AGE_DAYS ||
          process.env.WECHAT_SOGOU_MAX_AGE_DAYS ||
          "3",
      ),
  );

  if (!fromDate || !toDate) {
    throw new Error(
      "Usage: tsx scripts/repair-wechat-archive.ts --from YYYY-MM-DD --to YYYY-MM-DD [--max-age-days 3] [--tz Asia/Shanghai]",
    );
  }

  const result = await repairWechatDailyArchives({
    fromDate,
    toDate,
    timezoneName,
    maxAgeDays,
  });

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
