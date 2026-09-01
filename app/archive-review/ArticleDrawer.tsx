"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import styles from "./page.module.css";

function addNoReferrerToImages(html: string): string {
  return html.replace(/<img\b/gi, '<img referrerpolicy="no-referrer"');
}

export interface ArticleContentData {
  title: string;
  content_full_html: string;
  content_full_text: string;
  content_full_updated_at: string;
  content_full_error: string;
  content_text: string;
  summary_raw: string;
  lead_paragraph: string;
  original_url: string;
  info_url: string;
  canonical_url: string;
}

type FetchFn = (articleId: string) => Promise<ArticleContentData | null>;

const DrawerCtx = createContext<(articleId: string) => void>(() => {});

export function useOpenDrawer() {
  return useContext(DrawerCtx);
}

export function ArticleDrawerProvider({
  fetchContent,
  children,
}: {
  fetchContent: FetchFn;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ArticleContentData | null>(null);
  const [pending, startTransition] = useTransition();
  const drawerRef = useRef<HTMLDivElement>(null);

  const openDrawer = useCallback(
    (articleId: string) => {
      setOpen(true);
      setData(null);
      startTransition(async () => {
        const result = await fetchContent(articleId);
        setData(result);
      });
    },
    [fetchContent],
  );

  const close = useCallback(() => {
    setOpen(false);
    setData(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const externalUrl = data ? data.info_url || data.original_url || data.canonical_url : "";
  const sourceUrl =
    data?.original_url && data.original_url !== externalUrl ? data.original_url : "";

  const metaBar = (() => {
    if (!data) return null;
    const hasArchiveContent = Boolean(data.content_full_html || data.content_full_text);
    if (!hasArchiveContent || !data.content_full_updated_at) return null;
    return (
      <div className={styles.drawerMeta}>
        存档内容 · 抓取于{" "}
        {new Date(data.content_full_updated_at).toLocaleString("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
    );
  })();

  const contentEl = (() => {
    if (pending || !data) {
      return <p className={styles.drawerLoading}>加载中...</p>;
    }
    if (data.content_full_html) {
      return (
        <article
          className={styles.drawerHtml}
          dangerouslySetInnerHTML={{ __html: addNoReferrerToImages(data.content_full_html) }}
        />
      );
    }
    const text =
      data.content_full_text || data.content_text || data.summary_raw || data.lead_paragraph;
    if (text) {
      return <div className={styles.drawerText}>{text}</div>;
    }
    return (
      <p className={styles.drawerEmpty}>
        {data.content_full_error
          ? `内容抓取失败：${data.content_full_error}`
          : "完整内容暂不可用。"}
        {externalUrl ? (
          <>
            {" "}
            <a href={externalUrl} target="_blank" rel="noreferrer noopener">
              查看原文
            </a>
          </>
        ) : null}
      </p>
    );
  })();

  return (
    <DrawerCtx.Provider value={openDrawer}>
      {children}
      {open ? (
        <>
          <div className={styles.overlay} onClick={close} />
          <div className={styles.drawer} ref={drawerRef}>
            <div className={styles.drawerHeader}>
              <h2 className={styles.drawerTitle}>{data?.title || "加载中..."}</h2>
              <div className={styles.drawerActions}>
                {sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.drawerExtLink}
                  >
                    原始来源
                  </a>
                ) : null}
                {externalUrl ? (
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.drawerExtLink}
                  >
                    查看原文
                  </a>
                ) : null}
                <button type="button" className={styles.drawerClose} onClick={close}>
                  ✕
                </button>
              </div>
            </div>
            {metaBar}
            <div className={styles.drawerContent}>{contentEl}</div>
          </div>
        </>
      ) : null}
    </DrawerCtx.Provider>
  );
}

export function ArticleTitle({ articleId, children }: { articleId: string; children: ReactNode }) {
  const openDrawer = useOpenDrawer();
  return (
    <button type="button" className={styles.articleTitleBtn} onClick={() => openDrawer(articleId)}>
      {children}
    </button>
  );
}

export function ArchiveButton({
  articleId,
  hasContent,
  label = "查看存档",
  disabledLabel = "无存档",
}: {
  articleId: string;
  hasContent: boolean;
  label?: string;
  disabledLabel?: string;
}) {
  const openDrawer = useOpenDrawer();
  if (!hasContent) {
    return <span className={styles.archiveBtnDisabled}>{disabledLabel}</span>;
  }
  return (
    <button type="button" className={styles.archiveBtn} onClick={() => openDrawer(articleId)}>
      {label}
    </button>
  );
}
