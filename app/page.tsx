import { Rss, Sparkles, Tags, Newspaper } from "lucide-react";
import styles from "./page.module.css";

export default function HomePage() {
  return (
    <main className={styles.page}>
      {/* ── Nav ── */}
      <nav className={styles.nav}>
        <span className={styles.brand}>Article DB</span>
        <div className={styles.navLinks}>
          <a
            href="https://ai-news.stringzhao.life/"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.btnGhost}
          >
            阅读日报
          </a>
          <a href="/archive-review" className={styles.btnSolid}>
            管理后台
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>
          AI 驱动的文章情报平台
        </h1>
        <p className={styles.heroSub}>
          从 46 个信息源自动聚合、AI
          多维度评估、每日精选推送，让高质量内容不再被淹没。
        </p>
        <div className={styles.heroCta}>
          <a
            href="https://ai-news.stringzhao.life/"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.btnLargePrimary}
          >
            浏览今日精选
          </a>
          <a href="/archive-review" className={styles.btnLargeSecondary}>
            进入审查台
          </a>
        </div>
      </section>

      {/* ── Sources ── */}
      <section className={styles.section}>
        <p className={styles.sectionLabel}>数据源</p>
        <h2 className={styles.sectionTitle}>多渠道信息聚合</h2>
        <div className={styles.sourcesGrid}>
          <div className={styles.sourceCard} data-channel="rss">
            <div className={styles.sourceIcon} data-channel="rss">
              <Rss size={18} />
            </div>
            <h3 className={styles.sourceCardTitle}>RSS 博客</h3>
            <p className={styles.sourceCardCount}>8 个专业源</p>
            <p className={styles.sourceCardDesc}>
              Latent.Space、Hugging Face、LangChain、少数派等
            </p>
          </div>
          <div className={styles.sourceCard} data-channel="twitter">
            <div className={styles.sourceIcon} data-channel="twitter">𝕏</div>
            <h3 className={styles.sourceCardTitle}>Twitter / X</h3>
            <p className={styles.sourceCardCount}>29 个 KOL &amp; 官方</p>
            <p className={styles.sourceCardDesc}>
              宝玉、歸藏、Anthropic、OpenAI、Cursor 等
            </p>
          </div>
          <div className={styles.sourceCard} data-channel="wechat">
            <div className={styles.sourceIcon} data-channel="wechat">微</div>
            <h3 className={styles.sourceCardTitle}>微信公众号</h3>
            <p className={styles.sourceCardCount}>8 个头部账号</p>
            <p className={styles.sourceCardDesc}>
              量子位、机器之心、新智元、晚点LatePost 等
            </p>
          </div>
          <div className={styles.sourceCard} data-channel="github">
            <div className={styles.sourceIcon} data-channel="github">GH</div>
            <h3 className={styles.sourceCardTitle}>GitHub</h3>
            <p className={styles.sourceCardCount}>每日 Trending</p>
            <p className={styles.sourceCardDesc}>
              自动追踪全球热门开源项目动态
            </p>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className={styles.section}>
        <p className={styles.sectionLabel}>核心能力</p>
        <h2 className={styles.sectionTitle}>AI 赋能的内容筛选</h2>
        <div className={styles.featuresGrid}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>
              <Sparkles size={20} />
            </div>
            <h3 className={styles.featureCardTitle}>智能评分</h3>
            <p className={styles.featureCardDesc}>
              AI 对每篇文章进行多维度评分（质量、深度、时效性），自动分级为「必读」「可读」「跳过」。
            </p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>
              <Tags size={20} />
            </div>
            <h3 className={styles.featureCardTitle}>自动分类</h3>
            <p className={styles.featureCardDesc}>
              基于内容语义自动识别文章类型——技术深度、产品发布、行业分析、教程指南。
            </p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>
              <Newspaper size={20} />
            </div>
            <h3 className={styles.featureCardTitle}>每日精选</h3>
            <p className={styles.featureCardDesc}>
              每天自动生成高质量文章摘要，通过 AI News 日报推送给订阅者。
            </p>
          </div>
        </div>
      </section>

      {/* ── Workflow ── */}
      <section className={styles.section}>
        <p className={styles.sectionLabel}>运作方式</p>
        <h2 className={styles.sectionTitle}>三步完成内容筛选</h2>
        <div className={styles.workflowSteps}>
          <div className={styles.step}>
            <div className={styles.stepNumber}>1</div>
            <h3 className={styles.stepTitle}>聚合</h3>
            <p className={styles.stepDesc}>
              定时从 46 个源自动拉取最新内容，去重入库
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>2</div>
            <h3 className={styles.stepTitle}>评估</h3>
            <p className={styles.stepDesc}>
              AI 多维度评分、自动分类、生成结构化摘要
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>3</div>
            <h3 className={styles.stepTitle}>推送</h3>
            <p className={styles.stepDesc}>
              高质量文章归档，每日精选自动发布到日报
            </p>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className={styles.bottomCta}>
        <h2 className={styles.bottomCtaTitle}>开始阅读今日 AI 精选</h2>
        <div className={styles.bottomCtaBtn}>
          <a
            href="https://ai-news.stringzhao.life/"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.btnLargePrimary}
          >
            前往 AI News 日报
          </a>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        Article DB &middot; AI-Powered Article Intelligence
      </footer>
    </main>
  );
}